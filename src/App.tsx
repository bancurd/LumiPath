import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  BookOpenCheck,
  BookMarked,
  CalendarDays,
  LogIn,
  LogOut,
  Orbit,
  RotateCcw,
  UserRound,
  X,
} from 'lucide-react';
import {
  IslandBadge,
  IslandButton,
  IslandCalendarIcon,
  IslandCard,
} from 'animal-island-ui';
import vocabularyDataset from './data/vocabulary.json';

type Checkin = {
  date: string;
  learnedWords: number;
  source: 'daily-vocabulary';
};

type QuizMode = 'zh-to-en' | 'en-to-zh';

type WrongAnswer = {
  wordId: number;
  mistakes: number;
  lastWrongAt: string;
  modes: string[];
  lastSelected?: string;
};

type VocabularyWord = {
  id: number;
  word: string;
  lemma?: string;
  phonetic?: { uk?: string; us?: string };
  part_of_speech?: Array<{
    pos: string;
    pos_zh?: string;
    meanings?: Array<{ zh?: string; en?: string }>;
  }>;
  translations?: string[];
  difficulty?: { level?: string; cefr?: string; exam_tags?: string[] };
  example_sentences?: Array<{ en?: string; zh?: string }>;
  collocations?: Array<{ phrase?: string; zh?: string }>;
  memory_tip?: string;
};

const words = (vocabularyDataset.words as VocabularyWord[]).filter((item) => item.word);
const monthFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'long', year: 'numeric' });
const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];
const DAILY_WORD_COUNT = 10;
const QUIZ_QUESTION_COUNT = 10;
const CHALLENGE_LEVELS = [
  { level: 1, label: '轻松', maxHealth: 10, damage: 1, timeLimit: 30 },
  { level: 2, label: '标准', maxHealth: 8, damage: 1, timeLimit: 25 },
  { level: 3, label: '进阶', maxHealth: 6, damage: 1, timeLimit: 20 },
  { level: 4, label: '高压', maxHealth: 5, damage: 1, timeLimit: 15 },
  { level: 5, label: '极限', maxHealth: 3, damage: 1, timeLimit: 10 },
] as const;
type ChallengeLevel = (typeof CHALLENGE_LEVELS)[number];

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildMonthDays(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const days: Array<{ key: string; label: number; inMonth: boolean }> = [];

  for (let index = mondayOffset; index > 0; index -= 1) {
    const filler = new Date(year, month, 1 - index);
    days.push({ key: getLocalDateKey(filler), label: filler.getDate(), inMonth: false });
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const current = new Date(year, month, day);
    days.push({ key: getLocalDateKey(current), label: day, inMonth: true });
  }

  while (days.length % 7 !== 0) {
    const next = new Date(year, month, days.length - mondayOffset + 1);
    days.push({ key: getLocalDateKey(next), label: next.getDate(), inMonth: false });
  }

  return days;
}

function drawWords(count: number, pool = words) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function getPrimaryMeaning(word: VocabularyWord) {
  return word.part_of_speech?.[0]?.meanings?.[0]?.zh ?? word.translations?.[0] ?? '暂无中文释义';
}

function getEnglishDefinition(word: VocabularyWord) {
  return word.part_of_speech?.[0]?.meanings?.[0]?.en ?? 'No English definition yet.';
}

function buildQuizOptions(answer: VocabularyWord) {
  return drawWords(3, words.filter((word) => word.id !== answer.id)).concat(answer).sort(() => Math.random() - 0.5);
}

function App() {
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [wrongAnswers, setWrongAnswers] = useState<WrongAnswer[]>([]);
  const [wrongAnswersLoaded, setWrongAnswersLoaded] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [wrongBookOpen, setWrongBookOpen] = useState(false);
  const [profileName, setProfileName] = useState(() => window.localStorage.getItem('lumipath-profile') ?? '');
  const [draftName, setDraftName] = useState(profileName);
  const [saving, setSaving] = useState(false);
  const [learningWords, setLearningWords] = useState<VocabularyWord[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [guestWords, setGuestWords] = useState(() => drawWords(4));
  const [quizMode, setQuizMode] = useState<QuizMode>('zh-to-en');
  const [quizWords, setQuizWords] = useState<VocabularyWord[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizOptions, setQuizOptions] = useState<VocabularyWord[]>([]);
  const [selectedQuizWordId, setSelectedQuizWordId] = useState<number | null>(null);
  const [quizScore, setQuizScore] = useState(0);
  const [quizFinished, setQuizFinished] = useState(false);
  const [challengePickerOpen, setChallengePickerOpen] = useState(false);
  const [challengeActive, setChallengeActive] = useState(false);
  const [challengeLevel, setChallengeLevel] = useState<ChallengeLevel>(CHALLENGE_LEVELS[0]);
  const [challengeWord, setChallengeWord] = useState<VocabularyWord | null>(null);
  const [challengeOptions, setChallengeOptions] = useState<VocabularyWord[]>([]);
  const [challengeSelectedWordId, setChallengeSelectedWordId] = useState<number | null>(null);
  const [challengeHealth, setChallengeHealth] = useState<number>(CHALLENGE_LEVELS[0].maxHealth);
  const [challengeScore, setChallengeScore] = useState(0);
  const [challengeCombo, setChallengeCombo] = useState(0);
  const [challengeDamageFlash, setChallengeDamageFlash] = useState(0);
  const [challengeTimeLeft, setChallengeTimeLeft] = useState<number>(CHALLENGE_LEVELS[0].timeLimit);
  const [challengeTimedOut, setChallengeTimedOut] = useState(false);
  const [challengeGameOver, setChallengeGameOver] = useState(false);

  const isLoggedIn = profileName.trim().length > 0;
  const todayKey = getLocalDateKey();
  const monthDays = useMemo(() => buildMonthDays(new Date()), []);
  const checkedDates = useMemo(() => new Set(checkins.map((checkin) => checkin.date)), [checkins]);
  const checkedToday = checkedDates.has(todayKey);
  const currentWord = learningWords[currentWordIndex];
  const learningActive = learningWords.length > 0;
  const learningProgress = learningActive ? `${currentWordIndex + 1}/${learningWords.length}` : '0/0';
  const currentQuizWord = quizWords[quizIndex];
  const quizActive = quizWords.length > 0;
  const selectedQuizWord = quizOptions.find((word) => word.id === selectedQuizWordId);
  const quizAnswered = selectedQuizWordId !== null;
  const quizCorrect = selectedQuizWordId === currentQuizWord?.id;
  const quizRate = quizWords.length > 0 ? quizScore / quizWords.length : 0;
  const quizRank = quizRate >= 0.9 ? 'legend' : quizRate >= 0.7 ? 'great' : quizRate >= 0.4 ? 'steady' : 'starter';
  const challengeAnswered = challengeSelectedWordId !== null;
  const challengeCorrect = challengeSelectedWordId === challengeWord?.id;
  const challengeLowHealth = challengeHealth / challengeLevel.maxHealth <= 0.35;
  const challengeTimerRatio = challengeTimeLeft / challengeLevel.timeLimit;
  const challengeTimerDanger = challengeTimerRatio <= 0.3;
  const challengeHealthSegments = Array.from({ length: challengeLevel.maxHealth }, (_, index) => index);
  const wrongAnswerRows = useMemo(
    () => wrongAnswers
      .map((entry) => ({ entry, word: words.find((word) => word.id === entry.wordId) }))
      .filter((row): row is { entry: WrongAnswer; word: VocabularyWord } => Boolean(row.word))
      .sort((a, b) => b.entry.mistakes - a.entry.mistakes || b.entry.lastWrongAt.localeCompare(a.entry.lastWrongAt)),
    [wrongAnswers],
  );
  const totalLearnedWords = useMemo(
    () => checkins.reduce((total, checkin) => total + checkin.learnedWords, 0),
    [checkins],
  );
  const streak = useMemo(() => {
    let count = 0;
    const cursor = new Date();
    while (checkedDates.has(getLocalDateKey(cursor))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }, [checkedDates]);

  useEffect(() => {
    if (!isLoggedIn) {
      setCheckins([]);
      setWrongAnswers([]);
      setWrongAnswersLoaded(false);
      return;
    }

    fetch('/api/checkins')
      .then((response) => response.json())
      .then((data: { checkins?: Checkin[] }) => {
        if (Array.isArray(data.checkins)) {
          setCheckins(data.checkins);
        }
      })
      .catch(() => {
        const local = window.localStorage.getItem(`lumipath-checkins-${profileName}`);
        if (local) {
          setCheckins(JSON.parse(local) as Checkin[]);
        }
      });
  }, [isLoggedIn, profileName]);

  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }
    setWrongAnswersLoaded(false);
    const localWrongAnswers = window.localStorage.getItem(`lumipath-wrong-answers-${profileName}`);
    setWrongAnswers(localWrongAnswers ? JSON.parse(localWrongAnswers) as WrongAnswer[] : []);
    setWrongAnswersLoaded(true);
  }, [isLoggedIn, profileName]);
  useEffect(() => {
    if (isLoggedIn) {
      window.localStorage.setItem(`lumipath-checkins-${profileName}`, JSON.stringify(checkins));
      if (wrongAnswersLoaded) {
        window.localStorage.setItem(`lumipath-wrong-answers-${profileName}`, JSON.stringify(wrongAnswers));
      }
      window.localStorage.setItem('lumipath-profile', profileName);
    }
  }, [checkins, wrongAnswers, wrongAnswersLoaded, isLoggedIn, profileName]);

  function startDailyLearning() {
    if (!isLoggedIn) {
      setLoginOpen(true);
      return;
    }
    if (checkedToday || saving) {
      return;
    }
    setLearningWords(drawWords(DAILY_WORD_COUNT));
    setCurrentWordIndex(0);
    setAnswerVisible(false);
  }

  async function recordTodayCheckin(completedCount: number) {
    setSaving(true);
    try {
      const response = await fetch('/api/checkins/today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ learnedWords: completedCount }),
      });
      const data = (await response.json()) as { checkin: Checkin };
      setCheckins((current) => [...current.filter((item) => item.date !== data.checkin.date), data.checkin]);
      setProfileOpen(true);
    } catch {
      setCheckins((current) => [
        ...current.filter((item) => item.date !== todayKey),
        { date: todayKey, learnedWords: completedCount, source: 'daily-vocabulary' },
      ]);
      setProfileOpen(true);
    } finally {
      setSaving(false);
      setLearningWords([]);
      setCurrentWordIndex(0);
      setAnswerVisible(false);
    }
  }

  function masterCurrentWord() {
    if (currentWordIndex + 1 >= learningWords.length) {
      void recordTodayCheckin(learningWords.length);
      return;
    }
    setCurrentWordIndex((current) => current + 1);
    setAnswerVisible(false);
  }

  function restartLearningBatch() {
    setLearningWords(drawWords(DAILY_WORD_COUNT));
    setCurrentWordIndex(0);
    setAnswerVisible(false);
  }


  function recordWrongAnswer(word: VocabularyWord, mode: string, selectedText?: string) {
    if (!isLoggedIn) {
      return;
    }

    setWrongAnswers((current) => {
      const timestamp = new Date().toISOString();
      const existing = current.find((entry) => entry.wordId === word.id);
      if (!existing) {
        return current.concat({
          wordId: word.id,
          mistakes: 1,
          lastWrongAt: timestamp,
          modes: [mode],
          lastSelected: selectedText,
        });
      }

      return current.map((entry) => (
        entry.wordId === word.id
          ? {
              ...entry,
              mistakes: entry.mistakes + 1,
              lastWrongAt: timestamp,
              modes: Array.from(new Set(entry.modes.concat(mode))),
              lastSelected: selectedText,
            }
          : entry
      ));
    });
  }
  function startQuiz(mode: QuizMode) {
    setQuizMode(mode);
    const batch = drawWords(QUIZ_QUESTION_COUNT);
    setQuizWords(batch);
    setQuizIndex(0);
    setQuizOptions(buildQuizOptions(batch[0]));
    setSelectedQuizWordId(null);
    setQuizScore(0);
    setQuizFinished(false);
  }

  function chooseQuizOption(wordId: number) {
    if (quizAnswered) {
      return;
    }
    setSelectedQuizWordId(wordId);
    if (wordId === currentQuizWord.id) {
      setQuizScore((score) => score + 1);
      return;
    }

    const selectedWord = words.find((word) => word.id === wordId);
    recordWrongAnswer(
      currentQuizWord,
      quizMode === 'zh-to-en' ? '看中文选英文' : '看英文选中文',
      selectedWord ? (quizMode === 'zh-to-en' ? selectedWord.word : getPrimaryMeaning(selectedWord)) : undefined,
    );
  }

  function nextQuizQuestion() {
    if (quizIndex + 1 >= quizWords.length) {
      setQuizFinished(true);
      return;
    }
    const nextIndex = quizIndex + 1;
    setQuizIndex(nextIndex);
    setQuizOptions(buildQuizOptions(quizWords[nextIndex]));
    setSelectedQuizWordId(null);
  }
  function drawChallengeQuestion() {
    const [nextWord] = drawWords(1);
    setChallengeWord(nextWord);
    setChallengeOptions(buildQuizOptions(nextWord));
    setChallengeSelectedWordId(null);
    setChallengeTimedOut(false);
    setChallengeTimeLeft(challengeLevel.timeLimit);
  }

  function startChallenge(level: ChallengeLevel = CHALLENGE_LEVELS[0]) {
    setChallengeLevel(level);
    setChallengePickerOpen(false);
    setChallengeActive(true);
    setChallengeHealth(level.maxHealth);
    setChallengeTimeLeft(level.timeLimit);
    setChallengeTimedOut(false);
    setChallengeScore(0);
    setChallengeCombo(0);
    setChallengeDamageFlash(0);
    setChallengeGameOver(false);
    const [firstWord] = drawWords(1);
    setChallengeWord(firstWord);
    setChallengeOptions(buildQuizOptions(firstWord));
    setChallengeSelectedWordId(null);
  }

  function chooseChallengeOption(wordId: number) {
    if (!challengeWord || challengeAnswered || challengeGameOver) {
      return;
    }

    setChallengeSelectedWordId(wordId);
    setChallengeTimedOut(false);

    if (wordId === challengeWord.id) {
      setChallengeScore((score) => score + 1);
      setChallengeCombo((combo) => combo + 1);
      return;
    }

    applyChallengeMiss(false, wordId);
  }

  function applyChallengeMiss(timedOut = false, selectedWordId = challengeSelectedWordId) {
    setChallengeSelectedWordId(timedOut ? -1 : selectedWordId);
    setChallengeTimedOut(timedOut);
    if (challengeWord) {
      const selectedWord = challengeOptions.find((word) => word.id === selectedWordId);
      recordWrongAnswer(
        challengeWord,
        timedOut ? `挑战模式 难度${challengeLevel.level} 超时` : `挑战模式 难度${challengeLevel.level}`,
        timedOut ? '超时未选择' : selectedWord ? getPrimaryMeaning(selectedWord) : undefined,
      );
    }
    setChallengeCombo(0);
    setChallengeDamageFlash((tick) => tick + 1);
    setChallengeHealth((health) => {
      const nextHealth = Math.max(0, health - challengeLevel.damage);
      if (nextHealth === 0) {
        setChallengeGameOver(true);
      }
      return nextHealth;
    });
  }

  function nextChallengeQuestion() {
    if (challengeGameOver) {
      return;
    }
    drawChallengeQuestion();
  }


  useEffect(() => {
    if (!challengeActive || challengeGameOver || challengeAnswered) {
      return;
    }

    if (challengeTimeLeft <= 0) {
      const canContinue = challengeHealth > challengeLevel.damage;
      applyChallengeMiss(true);
      if (canContinue) {
        const advanceTimer = window.setTimeout(() => {
          drawChallengeQuestion();
        }, 650);
        return () => window.clearTimeout(advanceTimer);
      }
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setChallengeTimeLeft((time) => Math.max(0, time - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [challengeActive, challengeAnswered, challengeGameOver, challengeTimeLeft, challengeHealth, challengeLevel]);
  function submitLogin() {
    const name = draftName.trim();
    if (!name) {
      return;
    }
    setProfileName(name);
    setLoginOpen(false);
  }

  function logout() {
    setProfileOpen(false);
    setWrongBookOpen(false);
    setWrongAnswersLoaded(false);
    setProfileName('');
    setDraftName('');
    setLearningWords([]);
    setQuizWords([]);
    setCheckins([]);
    setWrongAnswers([]);
      setWrongAnswersLoaded(false);
    window.localStorage.removeItem('lumipath-profile');
  }

  return (
    <main className={`app-shell ${isLoggedIn ? '' : 'app-shell--guest'}`}>
      <div className="space-field" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="LumiPath home">
          <span className="brand-mark">L</span>
          <span>LumiPath</span>
        </a>
        {isLoggedIn ? (
          <nav className="nav-links" aria-label="主导航">
            <button type="button" onClick={() => setProfileOpen(true)}>个人信息</button>
            <a href="#roadmap">学习轮盘</a>
          </nav>
        ) : null}
        <IslandButton
          variant="ghost"
          icon={isLoggedIn ? <UserRound size={17} /> : <LogIn size={17} />}
          onClick={() => (isLoggedIn ? setProfileOpen(true) : setLoginOpen(true))}
        >
          {isLoggedIn ? '个人信息' : '登录'}
        </IslandButton>
      </header>

      {!isLoggedIn ? (
        <section className="hero guest-hero" id="top">
          <div className="hero-copy guest-copy">
            <IslandBadge>Guest Word Preview</IslandBadge>
            <h1>登录后开启每日打卡。</h1>
            <p>未登录时只展示随机单词预览。登录账户后，才能进入每日背词、完成打卡，并查看你的打卡日历。</p>
            <div className="hero-actions">
              <IslandButton icon={<LogIn size={18} />} onClick={() => setLoginOpen(true)}>登录账户</IslandButton>
              <IslandButton variant="ghost" icon={<RotateCcw size={18} />} onClick={() => setGuestWords(drawWords(4))}>换一组</IslandButton>
            </div>
            <div className="guest-word-panel" aria-label="随机单词预览">
              <div className="guest-word-panel__top">
                <span>随机单词预览</span>
                <strong>不记录进度</strong>
              </div>
              <div className="guest-word-grid">
                {guestWords.map((word) => (
                  <IslandCard className="guest-word-card" key={word.id}>
                    <span>{word.difficulty?.cefr ?? 'CEFR'}</span>
                    <h3>{word.word}</h3>
                    <p>{getEnglishDefinition(word)}</p>
                    <strong>{getPrimaryMeaning(word)}</strong>
                  </IslandCard>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="learning-wheel" id="roadmap">
          <div className="learning-wheel__heading">
            <IslandBadge>Learning Orbit</IslandBadge>
            <h1>把今天的学习从轮盘开始。</h1>
            <p>悬停或聚焦中心按钮展开功能。练习模式和挑战模式会继续向外弹出子轮盘。</p>
          </div>

          <div className="learning-wheel-stage" tabIndex={0} aria-label="学习功能轮盘">
            <button className="wheel-core" type="button" aria-label="开始学习功能轮盘">
              <span>START</span>
              <strong>开始学习</strong>
              <em>Hover to open</em>
            </button>

            <button
              className="wheel-node wheel-node--daily"
              type="button"
              onClick={startDailyLearning}
              disabled={checkedToday || saving}
            >
              <BookOpenCheck size={24} />
              <span>DAILY CHECK-IN</span>
              <strong>{checkedToday ? '今日已打卡' : '每日打卡'}</strong>
              <em>{checkedToday ? 'Calendar lit' : saving ? 'Saving...' : '10 words today'}</em>
            </button>

            <div className="wheel-node-wrap wheel-node-wrap--practice" tabIndex={0}>
              <button className="wheel-node wheel-node--practice" type="button">
                <BookOpenCheck size={24} />
                <span>PRACTICE SWITCH</span>
                <strong>选择练习模式</strong>
                <em>2 quiz paths</em>
              </button>
              <div className="wheel-submenu wheel-submenu--practice" aria-label="练习模式子轮盘">
                <button className="wheel-subitem wheel-subitem--blue" type="button" onClick={() => startQuiz('zh-to-en')}>
                  <span>01</span>
                  <strong>看中文选英文</strong>
                  <em>ZH to EN</em>
                </button>
                <button className="wheel-subitem wheel-subitem--green" type="button" onClick={() => startQuiz('en-to-zh')}>
                  <span>02</span>
                  <strong>看英文选中文</strong>
                  <em>EN to ZH</em>
                </button>
              </div>
            </div>

            <div className="wheel-node-wrap wheel-node-wrap--challenge" tabIndex={0}>
              <button className="wheel-node wheel-node--challenge" type="button">
                <Orbit size={24} />
                <span>CHALLENGE ARENA</span>
                <strong>挑战模式</strong>
                <em>5 difficulty rings</em>
              </button>
              <div className="wheel-submenu wheel-submenu--challenge" aria-label="挑战难度子轮盘">
                {CHALLENGE_LEVELS.map((level) => (
                  <button
                    key={level.level}
                    className={`wheel-subitem wheel-subitem--level wheel-subitem--level-${level.level}`}
                    type="button"
                    onClick={() => startChallenge(level)}
                  >
                    <span>{level.level}</span>
                    <strong>{level.label}</strong>
                    <em>{level.maxHealth}HP · {level.timeLimit}s</em>
                  </button>
                ))}
              </div>
            </div>

            <button className="wheel-node wheel-node--wrongbook" type="button" onClick={() => setWrongBookOpen(true)}>
              <BookMarked size={24} />
              <span>ERROR NOTEBOOK</span>
              <strong>错题本</strong>
              <em>{wrongAnswerRows.length} saved words</em>
            </button>
          </div>
        </section>
      )}

      {wrongBookOpen && isLoggedIn ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setWrongBookOpen(false)}>
          <section className="wrongbook-modal xyz-in" data-xyz="fade up small ease-out-back" role="dialog" aria-modal="true" aria-labelledby="wrongbook-title" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setWrongBookOpen(false)} aria-label="关闭错题本"><X size={18} /></button>
            <div className="wrongbook-cover">
              <BookMarked size={30} />
              <span>个人错题档案</span>
              <h2 id="wrongbook-title">错题本</h2>
              <p>{profileName} 的错词会按错误次数排序，最近答错的单词会自动靠前。</p>
              <strong>{wrongAnswerRows.reduce((total, row) => total + row.entry.mistakes, 0)} 次错误记录</strong>
            </div>
            <div className="wrongbook-pages">
              {wrongAnswerRows.length ? wrongAnswerRows.map(({ entry, word }, index) => (
                <article className="wrongbook-entry" key={entry.wordId}>
                  <div className="wrongbook-entry__rank">{String(index + 1).padStart(2, '0')}</div>
                  <div>
                    <span>{word.difficulty?.cefr ?? 'CEFR'} · {entry.modes.join(' / ')}</span>
                    <h3>{word.word}</h3>
                    <p>{getEnglishDefinition(word)}</p>
                    <strong>{getPrimaryMeaning(word)}</strong>
                    {entry.lastSelected ? <em>上次误选：{entry.lastSelected}</em> : null}
                  </div>
                  <div className="wrongbook-entry__count">
                    <strong>{entry.mistakes}</strong>
                    <span>次</span>
                  </div>
                </article>
              )) : (
                <div className="wrongbook-empty">
                  <BookOpenCheck size={42} />
                  <h3>还没有错题</h3>
                  <p>完成练习或挑战后，答错和超时的单词会自动收进这里。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
      {profileOpen && isLoggedIn ? (
        <div className="profile-backdrop" role="presentation" onClick={() => setProfileOpen(false)}>
          <section className="profile-dock" role="dialog" aria-modal="true" aria-labelledby="profile-title" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setProfileOpen(false)} aria-label="关闭个人信息"><X size={18} /></button>
            <div className="profile-dock__header">
              <div className="profile-avatar"><UserRound size={30} /></div>
              <div>
                <span>学习档案</span>
                <h2 id="profile-title">{profileName}</h2>
              </div>
              <IslandButton variant="ghost" icon={<LogOut size={16} />} onClick={logout}>退出登录</IslandButton>
            </div>
            <div className="profile-stats">
              <div><BadgeCheck size={18} /><span>打卡记录</span><strong>{checkins.length} 次</strong></div>
              <div><BookOpenCheck size={18} /><span>背过单词</span><strong>{totalLearnedWords} 个</strong></div>
              <div><CalendarDays size={18} /><span>连续打卡</span><strong>{streak} 天</strong></div>
            </div>
            <div className="island-calendar-card">
              <div className="island-calendar-card__top">
                <div><span>Island Calendar</span><h3>{monthFormatter.format(new Date())}</h3></div>
                <div className="calendar-icon"><IslandCalendarIcon /></div>
              </div>
              <div className="animal-calendar-week">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div>
              <div className="animal-calendar-grid">
                {monthDays.map((day) => {
                  const isToday = day.key === todayKey;
                  const isChecked = checkedDates.has(day.key);
                  return (
                    <div key={day.key} className={['animal-calendar-day', day.inMonth ? '' : 'animal-calendar-day--muted', isToday ? 'animal-calendar-day--today' : '', isChecked ? 'animal-calendar-day--checked' : ''].join(' ')} aria-label={`${day.key}${isChecked ? ' 已打卡' : ''}`}>
                      <span>{day.label}</span>
                      {isChecked ? <BookOpenCheck size={13} aria-hidden="true" /> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {learningActive && currentWord ? (
        <div className="modal-backdrop" role="presentation">
          <div className="study-modal" role="dialog" aria-modal="true" aria-labelledby="study-title">
            <button className="modal-close" onClick={() => setLearningWords([])} aria-label="关闭背词"><X size={18} /></button>
            <div className="study-modal__top">
              <span>WORD {learningProgress}</span>
              <button className="icon-action" onClick={restartLearningBatch} aria-label="重新抽词"><RotateCcw size={17} /></button>
            </div>
            <h2 id="study-title">{currentWord.word}</h2>
            <p className="phonetic-line">UK {currentWord.phonetic?.uk ?? '-'} · US {currentWord.phonetic?.us ?? '-'}</p>
            <div className="word-tags">
              <span>{currentWord.part_of_speech?.[0]?.pos ?? 'word'}</span>
              <span>{currentWord.difficulty?.cefr ?? 'CEFR'}</span>
              <span>{currentWord.difficulty?.level ?? 'level'}</span>
            </div>
            {answerVisible ? (
              <div className="answer-panel">
                <div><span>中文释义</span><strong>{getPrimaryMeaning(currentWord)}</strong></div>
                <div><span>英文解释</span><p>{getEnglishDefinition(currentWord)}</p></div>
                <div><span>例句</span><p>{currentWord.example_sentences?.[0]?.en ?? 'No example yet.'}</p><p>{currentWord.example_sentences?.[0]?.zh ?? ''}</p></div>
                {currentWord.memory_tip ? <div><span>记忆提示</span><p>{currentWord.memory_tip}</p></div> : null}
              </div>
            ) : <div className="recall-panel"><p>先尝试回忆释义，再查看答案。</p></div>}
            <div className="study-actions">
              <IslandButton variant="ghost" onClick={() => setAnswerVisible(true)}>查看答案</IslandButton>
              <IslandButton onClick={masterCurrentWord} disabled={!answerVisible || saving}>{currentWordIndex + 1 >= learningWords.length ? '完成并打卡' : '已掌握，下一个'}</IslandButton>
            </div>
          </div>
        </div>
      ) : null}

      {quizActive && currentQuizWord ? (
        <div className="modal-backdrop" role="presentation">
          <div className="quiz-modal" role="dialog" aria-modal="true" aria-labelledby="quiz-title">
            <button className="modal-close" onClick={() => setQuizWords([])} aria-label="关闭练习"><X size={18} /></button>
            {!quizFinished ? (
              <>
                <div className="quiz-progress-head">
                  <span>QUIZ {quizIndex + 1}/{quizWords.length}</span>
                  <strong>{quizScore}</strong>
                  <span>正确数</span>
                </div>
                <h2 id="quiz-title">{quizMode === 'zh-to-en' ? '看中文，选英文' : '看英文，选中文'}</h2>
                <div className="quiz-prompt">
                  <span>{quizMode === 'zh-to-en' ? '中文释义' : '英文单词'}</span>
                  <strong>{quizMode === 'zh-to-en' ? getPrimaryMeaning(currentQuizWord) : currentQuizWord.word}</strong>
                </div>
                <div className="quiz-options">
                  {quizOptions.map((option) => (
                    <button
                      key={option.id}
                      className={[
                        'quiz-option',
                        selectedQuizWordId === option.id ? 'quiz-option--selected' : '',
                        quizAnswered && option.id === currentQuizWord.id ? 'quiz-option--correct' : '',
                        quizAnswered && selectedQuizWordId === option.id && option.id !== currentQuizWord.id ? 'quiz-option--wrong' : '',
                      ].join(' ')}
                      onClick={() => chooseQuizOption(option.id)}
                    >
                      {quizMode === 'zh-to-en' ? option.word : getPrimaryMeaning(option)}
                    </button>
                  ))}
                </div>
                {quizAnswered ? (
                  <div className="quiz-feedback">
                    <strong>{quizCorrect ? '答对了' : '还差一点'}</strong>
                    <span>正确答案：{quizMode === 'zh-to-en' ? currentQuizWord.word : getPrimaryMeaning(currentQuizWord)}</span>
                    {selectedQuizWord && !quizCorrect ? <span>你的选择：{quizMode === 'zh-to-en' ? selectedQuizWord.word : getPrimaryMeaning(selectedQuizWord)}</span> : null}
                  </div>
                ) : null}
                <div className="study-actions">
                  <IslandButton onClick={nextQuizQuestion} disabled={!quizAnswered}>{quizIndex + 1 >= quizWords.length ? '查看成绩' : '下一题'}</IslandButton>
                </div>
              </>
            ) : (
              <div className={`quiz-result quiz-result--${quizRank}`}>
                <IslandBadge>Quiz complete</IslandBadge>
                <div className="quiz-score-frame">
                  <span>正确率</span>
                  <strong>{Math.round(quizRate * 100)}%</strong>
                  <em>{quizScore}/{quizWords.length}</em>
                </div>
                <h2>{quizRank === 'legend' ? '太稳了' : quizRank === 'great' ? '表现不错' : quizRank === 'steady' ? '继续加固' : '再练一轮'}</h2>
                <p>继续练习可以帮助你在英文单词和中文释义之间建立更快的反应。</p>
                <div className="study-actions">
                  <IslandButton variant="ghost" onClick={() => setQuizWords([])}>关闭</IslandButton>
                  <IslandButton onClick={() => startQuiz(quizMode)}>再练一组</IslandButton>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {challengeActive && challengeWord ? (
        <div className="modal-backdrop" role="presentation">
          <div className={`challenge-modal ${challengeLowHealth ? 'challenge-modal--danger' : ''}`} role="dialog" aria-modal="true" aria-labelledby="challenge-title">
            <button className="modal-close" onClick={() => setChallengeActive(false)} aria-label="关闭挑战">
              <X size={18} />
            </button>
            {!challengeGameOver ? (
              <>
                <div className="challenge-topline">
                  <span>挑战模式</span>
                  <strong>{challengeScore} 题</strong>
                  <em>COMBO {challengeCombo}</em>
                  <div className={`challenge-timer ${challengeTimerDanger ? 'challenge-timer--danger' : ''}`} style={{ '--timer-progress': `${challengeTimerRatio * 360}deg` } as React.CSSProperties}>
                    <strong>{challengeTimeLeft}</strong>
                    <span>秒</span>
                  </div>
                </div>
                <div className={`challenge-health ${challengeLowHealth ? 'challenge-health--low' : ''} ${challengeDamageFlash ? 'challenge-health--hit' : ''}`} key={challengeDamageFlash}>
                  <div className="challenge-health__meta">
                    <span>HP</span>
                    <strong>{challengeHealth}/{challengeLevel.maxHealth}</strong>
                  </div>
                  <div className="challenge-health__track">
                    <div className="challenge-health__segments" style={{ '--hp-count': challengeLevel.maxHealth } as React.CSSProperties}>
                      {challengeHealthSegments.map((segment) => (
                        <span key={segment} className={segment < challengeHealth ? 'challenge-health__segment challenge-health__segment--full' : 'challenge-health__segment'} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="challenge-word-card xyz-in" data-xyz="fade up small ease-out-back">
                  <span>选择中文释义</span>
                  <h2 id="challenge-title">{challengeWord.word}</h2>
                  <p>{getEnglishDefinition(challengeWord)}</p>
                </div>
                <div className="challenge-options xyz-in" data-xyz="fade up small stagger">
                  {challengeOptions.map((option) => (
                    <button
                      key={option.id}
                      className={[
                        'challenge-option',
                        challengeSelectedWordId === option.id ? 'challenge-option--selected' : '',
                        challengeAnswered && option.id === challengeWord.id ? 'challenge-option--correct' : '',
                        challengeAnswered && challengeSelectedWordId === option.id && option.id !== challengeWord.id ? 'challenge-option--wrong' : '',
                      ].join(' ')}
                      onClick={() => chooseChallengeOption(option.id)}
                    >
                      {getPrimaryMeaning(option)}
                    </button>
                  ))}
                </div>
                {challengeAnswered ? (
                  <div className="challenge-feedback">
                    <strong>{challengeCorrect ? '稳住了' : challengeTimedOut ? `超时 -${challengeLevel.damage}` : `扣血 -${challengeLevel.damage}`}</strong>
                    <span>正确答案：{getPrimaryMeaning(challengeWord)}</span>
                  </div>
                ) : null}
                <div className="study-actions">
                  <IslandButton onClick={nextChallengeQuestion} disabled={!challengeAnswered}>下一题</IslandButton>
                </div>
              </>
            ) : (
              <div className="challenge-gameover xyz-in" data-xyz="fade down small">
                <IslandBadge>Challenge over</IslandBadge>
                <h2>挑战结束</h2>
                <div className="challenge-final-score">
                  <span>最终答对</span>
                  <strong>{challengeScore}</strong>
                  <em>题</em>
                </div>
                <p>血量归零了。再来一轮，看看能不能打破这次纪录。</p>
                <div className="study-actions">
                  <IslandButton variant="ghost" onClick={() => setChallengeActive(false)}>关闭</IslandButton>
                  <IslandButton onClick={() => startChallenge(challengeLevel)}>重新挑战</IslandButton>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
      {loginOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div className="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
            <button className="modal-close" onClick={() => setLoginOpen(false)} aria-label="关闭登录"><X size={18} /></button>
            <span>LOGIN</span>
            <h2 id="login-title">登录学习账户</h2>
            <p>输入昵称即可进入学习中心。登录后才会展示每日打卡入口和日历。</p>
            <label htmlFor="profile-name">账户昵称</label>
            <input id="profile-name" value={draftName} placeholder="例如 Leo" onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitLogin(); }} />
            <IslandButton onClick={submitLogin}>进入学习中心</IslandButton>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;









































