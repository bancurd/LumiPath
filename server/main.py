from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


DB_PATH = Path(os.environ.get("LUMIPATH_DB_PATH", Path.cwd() / "data" / "lumipath.sqlite"))
SESSION_DAYS = 30

app = FastAPI(title="LumiPath API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AuthPayload(BaseModel):
    displayName: str = Field(min_length=1)
    password: str = Field(min_length=4)


class CheckinPayload(BaseModel):
    learnedWords: int = 12
    wordIds: list[int] = Field(default_factory=list)


class WrongAnswerPayload(BaseModel):
    wordId: int
    mode: str = Field(min_length=1)
    selectedText: str | None = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_key() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def normalize_username(display_name: str) -> str:
    return display_name.strip().casefold()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT NOT NULL UNIQUE,
              display_name TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              last_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS sessions (
              token TEXT PRIMARY KEY,
              user_id INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS checkins (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              date TEXT NOT NULL,
              learned_words INTEGER NOT NULL,
              source TEXT NOT NULL DEFAULT 'daily-vocabulary',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(user_id, date),
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS learned_words (
              user_id INTEGER NOT NULL,
              word_id INTEGER NOT NULL,
              first_learned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              exposures INTEGER NOT NULL DEFAULT 1,
              mastered_count INTEGER NOT NULL DEFAULT 1,
              source TEXT NOT NULL DEFAULT 'daily-vocabulary',
              PRIMARY KEY(user_id, word_id),
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS wrong_answers (
              user_id INTEGER NOT NULL,
              word_id INTEGER NOT NULL,
              mistakes INTEGER NOT NULL DEFAULT 1,
              last_wrong_at TEXT NOT NULL,
              modes_json TEXT NOT NULL DEFAULT '[]',
              last_selected TEXT,
              PRIMARY KEY(user_id, word_id),
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, date);
            CREATE INDEX IF NOT EXISTS idx_learned_words_user_seen ON learned_words(user_id, last_seen_at);
            CREATE INDEX IF NOT EXISTS idx_wrong_answers_user_recent ON wrong_answers(user_id, last_wrong_at);
            """
        )


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt.encode("utf-8"), n=16384, r=8, p=1).hex()
    return f"{salt}:{digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, digest = stored_hash.split(":", 1)
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt.encode("utf-8"), n=16384, r=8, p=1).hex()
        return hmac.compare_digest(actual, digest)
    except ValueError:
        return False


def serialize_user(row: sqlite3.Row, token: str | None = None) -> dict:
    payload = {
        "id": row["id"],
        "username": row["username"],
        "displayName": row["display_name"],
    }
    if token:
        payload["token"] = token
    return payload


def create_session(db: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=SESSION_DAYS)
    db.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, user_id, now.isoformat(), expires.isoformat()),
    )
    return token


def current_user(authorization: Annotated[str | None, Header()] = None) -> sqlite3.Row:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing session token.")

    token = authorization.removeprefix("Bearer ").strip()
    with connect() as db:
        row = db.execute(
            """
            SELECT users.id, users.username, users.display_name
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ? AND sessions.expires_at > ?
            """,
            (token, utc_now()),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")
    return row


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "lumipath-api",
        "storage": "sqlite",
        "framework": "fastapi",
        "dbPath": str(DB_PATH),
    }


@app.post("/api/auth/register")
def register(payload: AuthPayload) -> dict:
    display_name = payload.displayName.strip()
    username = normalize_username(display_name)
    with connect() as db:
        existing = db.execute("SELECT id, password_hash FROM users WHERE username = ?", (username,)).fetchone()
        if existing and existing["password_hash"]:
            raise HTTPException(status_code=409, detail="这个账户已经注册，请直接登录。")

        if existing:
            db.execute(
                """
                UPDATE users
                SET display_name = ?, password_hash = ?, last_login_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (display_name, hash_password(payload.password), existing["id"]),
            )
            user_id = existing["id"]
        else:
            cursor = db.execute(
                """
                INSERT INTO users (username, display_name, password_hash, last_login_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (username, display_name, hash_password(payload.password)),
            )
            user_id = cursor.lastrowid

        user = db.execute(
            "SELECT id, username, display_name FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        token = create_session(db, int(user["id"]))

    return {"user": serialize_user(user, token)}


@app.post("/api/auth/login")
def login(payload: AuthPayload) -> dict:
    display_name = payload.displayName.strip()
    username = normalize_username(display_name)
    with connect() as db:
        user = db.execute(
            "SELECT id, username, display_name, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if user is None or not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="账户或密码不正确。")

        db.execute("UPDATE users SET display_name = ?, last_login_at = CURRENT_TIMESTAMP WHERE id = ?", (display_name, user["id"]))
        fresh_user = db.execute("SELECT id, username, display_name FROM users WHERE id = ?", (user["id"],)).fetchone()
        token = create_session(db, int(user["id"]))

    return {"user": serialize_user(fresh_user, token)}


@app.get("/api/checkins")
def get_checkins(user: Annotated[sqlite3.Row, Depends(current_user)]) -> dict:
    with connect() as db:
        rows = db.execute(
            """
            SELECT date, learned_words, source
            FROM checkins
            WHERE user_id = ?
            ORDER BY date
            """,
            (user["id"],),
        ).fetchall()
    return {
        "checkins": [
            {"date": row["date"], "learnedWords": row["learned_words"], "source": row["source"]}
            for row in rows
        ]
    }


@app.post("/api/checkins/today")
def post_today_checkin(payload: CheckinPayload, user: Annotated[sqlite3.Row, Depends(current_user)]) -> dict:
    date = today_key()
    learned_words = max(1, int(payload.learnedWords))
    with connect() as db:
        db.execute(
            """
            INSERT INTO checkins (user_id, date, learned_words, source)
            VALUES (?, ?, ?, 'daily-vocabulary')
            ON CONFLICT(user_id, date) DO UPDATE SET
              learned_words = excluded.learned_words,
              updated_at = CURRENT_TIMESTAMP
            """,
            (user["id"], date, learned_words),
        )
        for word_id in sorted(set(payload.wordIds)):
            db.execute(
                """
                INSERT INTO learned_words (user_id, word_id, source)
                VALUES (?, ?, 'daily-vocabulary')
                ON CONFLICT(user_id, word_id) DO UPDATE SET
                  last_seen_at = CURRENT_TIMESTAMP,
                  exposures = exposures + 1,
                  mastered_count = mastered_count + 1
                """,
                (user["id"], word_id),
            )

    return {
        "checkin": {"date": date, "learnedWords": learned_words, "source": "daily-vocabulary"},
        "message": "Daily vocabulary learning completed.",
    }


@app.get("/api/learned-words")
def get_learned_words(user: Annotated[sqlite3.Row, Depends(current_user)]) -> dict:
    with connect() as db:
        rows = db.execute(
            """
            SELECT word_id, first_learned_at, last_seen_at, exposures, mastered_count, source
            FROM learned_words
            WHERE user_id = ?
            ORDER BY last_seen_at DESC
            """,
            (user["id"],),
        ).fetchall()
    return {
        "learnedWords": [
            {
                "wordId": row["word_id"],
                "firstLearnedAt": row["first_learned_at"],
                "lastSeenAt": row["last_seen_at"],
                "exposures": row["exposures"],
                "masteredCount": row["mastered_count"],
                "source": row["source"],
            }
            for row in rows
        ]
    }


@app.get("/api/wrong-answers")
def get_wrong_answers(user: Annotated[sqlite3.Row, Depends(current_user)]) -> dict:
    with connect() as db:
        rows = db.execute(
            """
            SELECT word_id, mistakes, last_wrong_at, modes_json, last_selected
            FROM wrong_answers
            WHERE user_id = ?
            ORDER BY mistakes DESC, last_wrong_at DESC
            """,
            (user["id"],),
        ).fetchall()
    return {
        "wrongAnswers": [
            {
                "wordId": row["word_id"],
                "mistakes": row["mistakes"],
                "lastWrongAt": row["last_wrong_at"],
                "modes": json.loads(row["modes_json"]),
                "lastSelected": row["last_selected"],
            }
            for row in rows
        ]
    }


@app.post("/api/wrong-answers")
def post_wrong_answer(payload: WrongAnswerPayload, user: Annotated[sqlite3.Row, Depends(current_user)]) -> dict:
    timestamp = utc_now()
    with connect() as db:
        existing = db.execute(
            "SELECT modes_json FROM wrong_answers WHERE user_id = ? AND word_id = ?",
            (user["id"], payload.wordId),
        ).fetchone()
        modes = sorted(set((json.loads(existing["modes_json"]) if existing else []) + [payload.mode]))
        db.execute(
            """
            INSERT INTO wrong_answers (user_id, word_id, mistakes, last_wrong_at, modes_json, last_selected)
            VALUES (?, ?, 1, ?, ?, ?)
            ON CONFLICT(user_id, word_id) DO UPDATE SET
              mistakes = mistakes + 1,
              last_wrong_at = excluded.last_wrong_at,
              modes_json = excluded.modes_json,
              last_selected = excluded.last_selected
            """,
            (user["id"], payload.wordId, timestamp, json.dumps(modes, ensure_ascii=False), payload.selectedText),
        )
        row = db.execute(
            """
            SELECT word_id, mistakes, last_wrong_at, modes_json, last_selected
            FROM wrong_answers
            WHERE user_id = ? AND word_id = ?
            """,
            (user["id"], payload.wordId),
        ).fetchone()

    return {
        "wrongAnswer": {
            "wordId": row["word_id"],
            "mistakes": row["mistakes"],
            "lastWrongAt": row["last_wrong_at"],
            "modes": json.loads(row["modes_json"]),
            "lastSelected": row["last_selected"],
        }
    }
