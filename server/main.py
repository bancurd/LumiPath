from __future__ import annotations

import hashlib
import hmac
import json
import os
import random
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


DB_PATH = Path(os.environ.get("LUMIPATH_DB_PATH", Path.cwd() / "data" / "lumipath.sqlite"))
VOCABULARY_PATH = Path.cwd() / "src" / "data" / "vocabulary.json"
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


class ReviewResultPayload(BaseModel):
    wordId: int
    grade: str = Field(pattern="^(again|hard|good|easy)$")
    source: str = "practice"


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
              resolved_streak INTEGER NOT NULL DEFAULT 0,
              last_wrong_at TEXT NOT NULL,
              modes_json TEXT NOT NULL DEFAULT '[]',
              last_selected TEXT,
              PRIMARY KEY(user_id, word_id),
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_word_state (
              user_id INTEGER NOT NULL,
              word_id INTEGER NOT NULL,
              status TEXT NOT NULL DEFAULT 'new',
              seen_count INTEGER NOT NULL DEFAULT 0,
              correct_count INTEGER NOT NULL DEFAULT 0,
              wrong_count INTEGER NOT NULL DEFAULT 0,
              streak_correct INTEGER NOT NULL DEFAULT 0,
              ease_factor REAL NOT NULL DEFAULT 2.3,
              interval_days INTEGER NOT NULL DEFAULT 0,
              due_at TEXT,
              last_seen_at TEXT,
              last_grade TEXT,
              source TEXT NOT NULL DEFAULT 'daily-vocabulary',
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY(user_id, word_id),
              FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, date);
            CREATE INDEX IF NOT EXISTS idx_learned_words_user_seen ON learned_words(user_id, last_seen_at);
            CREATE INDEX IF NOT EXISTS idx_wrong_answers_user_recent ON wrong_answers(user_id, last_wrong_at);
            CREATE INDEX IF NOT EXISTS idx_word_state_user_due ON user_word_state(user_id, due_at);
            CREATE INDEX IF NOT EXISTS idx_word_state_user_status ON user_word_state(user_id, status);
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(wrong_answers)").fetchall()}
        if "resolved_streak" not in columns:
            db.execute("ALTER TABLE wrong_answers ADD COLUMN resolved_streak INTEGER NOT NULL DEFAULT 0")


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


def vocabulary_word_ids() -> list[int]:
    with VOCABULARY_PATH.open("r", encoding="utf-8") as file:
        payload = json.load(file)
    return [int(word["id"]) for word in payload.get("words", []) if word.get("id") is not None and word.get("word")]


def pick_unique(target: list[int], candidates: list[int], limit: int) -> None:
    for word_id in candidates:
        if len(target) >= limit:
            return
        if word_id not in target:
            target.append(word_id)


def word_states(db: sqlite3.Connection, user_id: int) -> dict[int, sqlite3.Row]:
    rows = db.execute(
        """
        SELECT word_id, status, seen_count, correct_count, wrong_count, streak_correct,
               ease_factor, interval_days, due_at, last_seen_at, last_grade
        FROM user_word_state
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchall()
    return {int(row["word_id"]): row for row in rows}


def select_srs_words(user_id: int, count: int, purpose: str) -> list[int]:
    count = max(1, min(count, 30))
    all_ids = vocabulary_word_ids()
    now = utc_now()
    with connect() as db:
        states = word_states(db, user_id)

    known_ids = set(states)
    due = [
        word_id
        for word_id, state in states.items()
        if state["due_at"] and state["due_at"] <= now
    ]
    due.sort(key=lambda word_id: (states[word_id]["due_at"], -states[word_id]["wrong_count"]))

    weak = [
        word_id
        for word_id, state in states.items()
        if word_id not in due and (state["wrong_count"] > 0 or state["status"] in ("learning", "reviewing"))
    ]
    weak.sort(key=lambda word_id: (-states[word_id]["wrong_count"], states[word_id]["streak_correct"], states[word_id]["last_seen_at"] or ""))

    new_words = [word_id for word_id in all_ids if word_id not in known_ids]
    random.shuffle(new_words)

    selected: list[int] = []
    if purpose == "daily":
        pick_unique(selected, due, min(count, 6))
        pick_unique(selected, weak, min(count, len(selected) + 2))
        pick_unique(selected, new_words, count)
    else:
        pick_unique(selected, due, min(count, 5))
        pick_unique(selected, weak, min(count, len(selected) + 4))
        pick_unique(selected, new_words, count)

    if len(selected) < count:
        fallback = all_ids[:]
        random.shuffle(fallback)
        pick_unique(selected, fallback, count)

    return selected[:count]


def apply_review_result(db: sqlite3.Connection, user_id: int, word_id: int, grade: str, source: str) -> None:
    current = db.execute(
        """
        SELECT seen_count, correct_count, wrong_count, streak_correct, ease_factor, interval_days
        FROM user_word_state
        WHERE user_id = ? AND word_id = ?
        """,
        (user_id, word_id),
    ).fetchone()
    seen_count = int(current["seen_count"]) if current else 0
    correct_count = int(current["correct_count"]) if current else 0
    wrong_count = int(current["wrong_count"]) if current else 0
    streak_correct = int(current["streak_correct"]) if current else 0
    ease_factor = float(current["ease_factor"]) if current else 2.3
    interval_days = int(current["interval_days"]) if current else 0

    if grade == "again":
        wrong_count += 1
        streak_correct = 0
        ease_factor = max(1.3, ease_factor - 0.25)
        interval_days = 1
    elif grade == "hard":
        correct_count += 1
        streak_correct += 1
        ease_factor = max(1.3, ease_factor - 0.1)
        interval_days = max(1, round(max(interval_days, 1) * 1.2))
    elif grade == "easy":
        correct_count += 1
        streak_correct += 1
        ease_factor = min(3.0, ease_factor + 0.1)
        interval_days = 3 if interval_days < 1 else max(1, round(interval_days * ease_factor * 1.4))
    else:
        correct_count += 1
        streak_correct += 1
        interval_days = 1 if interval_days < 1 else max(1, round(interval_days * ease_factor))

    status = "mastered" if streak_correct >= 4 and interval_days >= 14 else "reviewing" if seen_count > 0 else "learning"
    now = datetime.now(timezone.utc)
    due_at = (now + timedelta(days=interval_days)).isoformat()
    now_text = now.isoformat()

    db.execute(
        """
        INSERT INTO user_word_state (
          user_id, word_id, status, seen_count, correct_count, wrong_count,
          streak_correct, ease_factor, interval_days, due_at, last_seen_at,
          last_grade, source, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, word_id) DO UPDATE SET
          status = excluded.status,
          seen_count = excluded.seen_count,
          correct_count = excluded.correct_count,
          wrong_count = excluded.wrong_count,
          streak_correct = excluded.streak_correct,
          ease_factor = excluded.ease_factor,
          interval_days = excluded.interval_days,
          due_at = excluded.due_at,
          last_seen_at = excluded.last_seen_at,
          last_grade = excluded.last_grade,
          source = excluded.source,
          updated_at = CURRENT_TIMESTAMP
        """,
        (
            user_id,
            word_id,
            status,
            seen_count + 1,
            correct_count,
            wrong_count,
            streak_correct,
            ease_factor,
            interval_days,
            due_at,
            now_text,
            grade,
            source,
        ),
    )


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
            apply_review_result(db, int(user["id"]), word_id, "good", "daily-vocabulary")
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


@app.get("/api/words/daily")
def get_daily_words(user: Annotated[sqlite3.Row, Depends(current_user)], count: int = Query(10, ge=1, le=30)) -> dict:
    return {
        "wordIds": select_srs_words(int(user["id"]), count, "daily"),
        "strategy": "srs-daily",
    }


@app.get("/api/words/practice")
def get_practice_words(user: Annotated[sqlite3.Row, Depends(current_user)], count: int = Query(10, ge=1, le=30)) -> dict:
    return {
        "wordIds": select_srs_words(int(user["id"]), count, "practice"),
        "strategy": "srs-practice",
    }


@app.post("/api/words/review-result")
def post_review_result(payload: ReviewResultPayload, user: Annotated[sqlite3.Row, Depends(current_user)]) -> dict:
    with connect() as db:
        apply_review_result(db, int(user["id"]), payload.wordId, payload.grade, payload.source)
        graduated = False
        if payload.source == "practice":
            existing = db.execute(
                "SELECT resolved_streak FROM wrong_answers WHERE user_id = ? AND word_id = ?",
                (user["id"], payload.wordId),
            ).fetchone()
            if existing and payload.grade in ("good", "easy"):
                next_streak = int(existing["resolved_streak"]) + 1
                if next_streak >= 3:
                    db.execute(
                        "DELETE FROM wrong_answers WHERE user_id = ? AND word_id = ?",
                        (user["id"], payload.wordId),
                    )
                    graduated = True
                else:
                    db.execute(
                        "UPDATE wrong_answers SET resolved_streak = ? WHERE user_id = ? AND word_id = ?",
                        (next_streak, user["id"], payload.wordId),
                    )
            elif existing and payload.grade == "again":
                db.execute(
                    "UPDATE wrong_answers SET resolved_streak = 0 WHERE user_id = ? AND word_id = ?",
                    (user["id"], payload.wordId),
                )
    return {"ok": True, "graduatedWrongAnswer": graduated}


@app.get("/api/wrong-answers")
def get_wrong_answers(user: Annotated[sqlite3.Row, Depends(current_user)]) -> dict:
    with connect() as db:
        rows = db.execute(
            """
            SELECT word_id, mistakes, resolved_streak, last_wrong_at, modes_json, last_selected
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
                "resolvedStreak": row["resolved_streak"],
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
            INSERT INTO wrong_answers (user_id, word_id, mistakes, resolved_streak, last_wrong_at, modes_json, last_selected)
            VALUES (?, ?, 1, 0, ?, ?, ?)
            ON CONFLICT(user_id, word_id) DO UPDATE SET
              mistakes = mistakes + 1,
              resolved_streak = 0,
              last_wrong_at = excluded.last_wrong_at,
              modes_json = excluded.modes_json,
              last_selected = excluded.last_selected
            """,
            (user["id"], payload.wordId, timestamp, json.dumps(modes, ensure_ascii=False), payload.selectedText),
        )
        row = db.execute(
            """
            SELECT word_id, mistakes, resolved_streak, last_wrong_at, modes_json, last_selected
            FROM wrong_answers
            WHERE user_id = ? AND word_id = ?
            """,
            (user["id"], payload.wordId),
        ).fetchone()

    return {
        "wrongAnswer": {
            "wordId": row["word_id"],
            "mistakes": row["mistakes"],
            "resolvedStreak": row["resolved_streak"],
            "lastWrongAt": row["last_wrong_at"],
            "modes": json.loads(row["modes_json"]),
            "lastSelected": row["last_selected"],
        }
    }


@app.delete("/api/wrong-answers/{word_id}")
def delete_wrong_answer(word_id: int, user: Annotated[sqlite3.Row, Depends(current_user)]) -> dict:
    with connect() as db:
        db.execute(
            "DELETE FROM wrong_answers WHERE user_id = ? AND word_id = ?",
            (user["id"], word_id),
        )
    return {"ok": True}
