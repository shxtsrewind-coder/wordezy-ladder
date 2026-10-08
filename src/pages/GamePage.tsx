import React, { useCallback, useEffect, useState } from "react";
import {
  Lock,
  Sparkles,
  RefreshCw,
  Flame,
  Timer as TimerIcon,
  WifiOff,
  Award,
  Play,
  Share2,
  Check,
  Lightbulb,
  Footprints,
  Keyboard,
  Route,
} from "lucide-react";
import { LadderBoard } from "../components/LadderBoard.tsx";
import { Leaderboard } from "../components/Leaderboard.tsx";
import { AuthModal } from "../components/AuthModal.tsx";
import { Confetti } from "../components/Confetti.tsx";
import { AchievementToastStack } from "../components/AchievementToast.tsx";
import { AchievementsModal } from "../components/AchievementsModal.tsx";
import { getDailyPuzzle, getRandomPuzzle, todayUtc, msUntilNextPuzzle, nextBestWord, type Puzzle, type WordLength } from "../lib/ladder.ts";
import { localSave, type DailyProgress } from "../lib/localSave.ts";
import { submitScore, ensureProfile } from "../lib/leaderboard.ts";
import { supabase, ensureSession } from "../lib/supabase.ts";
import { useElapsed, formatTime, formatCountdown } from "../hooks/useTimer.ts";
import { ACHIEVEMENTS, diffNewlyUnlocked, type Achievement } from "../data/achievements.ts";
import { buildShareText, shareResult } from "../lib/share.ts";

type Mode = "daily" | "unlimited";
type Phase = "auth_checking" | "choice" | "ready" | "auth_blocked";

/** Shown once per browser session — a returning guest isn't re-prompted on
 *  every reload, only on a fresh session. */
const PLAY_CHOICE_KEY = "wordezyLadder.playChoice";

const OTHER_GAMES = [
  { name: "Wordezy", url: "https://wordezy.bgameworld.com/" },
  { name: "Wordezy Search", url: "https://wordezysearch.bgameworld.com/" },
  { name: "Wordezy Scramble", url: "https://wordezyscramble.bgameworld.com/" },
  { name: "When & Where", url: "https://whenandwhere.bgameworld.com/" },
];

/** The brand tiles climbing like steps — this is the ladder game. */
const WordmarkTiles: React.FC<{ className?: string }> = ({ className = "flex" }) => (
  <div className={`${className} items-end gap-1 h-8`} aria-hidden="true">
    {["W", "O", "R", "D"].map((letter, i) => (
      <span
        key={i}
        className={`w-6 h-6 rounded-[4px] flex items-center justify-center font-display font-semibold text-[11px] ${
          i % 2 === 0 ? "bg-correct text-ink" : "bg-present text-ink"
        }`}
        style={{ marginBottom: `${i * 3}px` }}
      >
        {letter}
      </span>
    ))}
  </div>
);

/** One shortest route, shown after a ladder is finished or given up. */
const RouteLine: React.FC<{ route: string[] }> = ({ route }) => (
  <p className="text-sm font-mono text-paper/80 leading-relaxed break-words">
    {route.map((w, i) => (
      <span key={i}>
        {i > 0 && <span className="text-faint"> → </span>}
        <span className={i === 0 || i === route.length - 1 ? "text-correct" : ""}>{w.toUpperCase()}</span>
      </span>
    ))}
  </p>
);

export const GamePage: React.FC = () => {
  const [phase, setPhase] = useState<Phase>("auth_checking");
  const [authBlockedReason, setAuthBlockedReason] = useState<"anonymous_disabled" | "unknown">("unknown");
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Player");
  /** The leaderboard RPC needs a name, so guests who never picked one aren't submitted. */
  const [hasProfile, setHasProfile] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const [mode, setMode] = useState<Mode>("daily");
  const [save, setSave] = useState(() => localSave.get());
  const [today] = useState(() => todayUtc());
  const [daily] = useState(() => getDailyPuzzle(today));

  const [leaderboardKey, setLeaderboardKey] = useState(0);
  const [scoreStatus, setScoreStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [showAchievements, setShowAchievements] = useState(false);
  const [newlyUnlocked, setNewlyUnlocked] = useState<Achievement[] | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "shared" | "copied" | "failed">("idle");

  // Classic Unlimited lives in memory only — every ladder is fresh anyway.
  const [uLength, setULength] = useState<WordLength>(() => localSave.get().lastUnlimitedLength);
  const [unlimited, setUnlimited] = useState<Puzzle>(() => getRandomPuzzle(localSave.get().lastUnlimitedLength));
  const [uWords, setUWords] = useState<string[]>([]);
  const [uHintAt, setUHintAt] = useState<number[]>([]);
  const [uHints, setUHints] = useState(0);
  const [uGaveUp, setUGaveUp] = useState(false);
  const [uStartedAt, setUStartedAt] = useState<number>(() => Date.now());
  const [uFinishedMs, setUFinishedMs] = useState<number | null>(null);

  const progress: DailyProgress | null = save.daily && save.daily.date === today ? save.daily : null;
  const dailyDone = !!progress && progress.finishedMs !== null;
  const dailyRunning = !!progress && !dailyDone && phase === "ready";
  const dailyElapsed = useElapsed(progress?.startedAt ?? null, dailyRunning);
  const dailyTime = dailyDone ? (progress!.finishedMs as number) : dailyElapsed;

  const unlimitedDone = uFinishedMs !== null || uGaveUp;
  const unlimitedElapsed = useElapsed(uStartedAt, mode === "unlimited" && !unlimitedDone && save.unlockedUnlimited);
  const unlimitedTime = uFinishedMs ?? unlimitedElapsed;

  const submitDaily = useCallback(
    (steps: number, hints: number, timeMs: number) => {
      setScoreStatus("saving");
      submitScore({ puzzleDate: today, steps, hints, par: daily.par, timeMs })
        .then(() => {
          setScoreStatus("saved");
          setLeaderboardKey((k) => k + 1);
        })
        .catch(() => setScoreStatus("failed"));
    },
    [today, daily.par]
  );

  const bootAuth = useCallback(async () => {
    setPhase("auth_checking");
    try {
      const session = await ensureSession();
      if (!session.ok) {
        setAuthBlockedReason(session.reason || "unknown");
        setPhase("auth_blocked");
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;
      const anon = userData.user?.is_anonymous ?? true;
      setUserId(uid);

      const name = await ensureProfile().catch(() => null);
      if (name) {
        setDisplayName(name);
        setHasProfile(true);
        // A finish from earlier today that never reached the server (offline,
        // closed tab) gets another try. Only the first finish ever counts.
        const s = localSave.get();
        if (s.daily && s.daily.date === todayUtc() && s.daily.finishedMs !== null) {
          submitScore({
            puzzleDate: s.daily.date,
            steps: s.daily.words.length,
            hints: s.daily.hints,
            par: getDailyPuzzle(s.daily.date).par,
            timeMs: s.daily.finishedMs,
          })
            .then(() => setLeaderboardKey((k) => k + 1))
            .catch(() => undefined);
        }
      }

      const choiceDone = typeof window !== "undefined" && sessionStorage.getItem(PLAY_CHOICE_KEY) === "true";
      setPhase(!anon || choiceDone || name ? "ready" : "choice");
    } catch (err) {
      console.error("Failed to establish session:", err);
      setAuthBlockedReason("unknown");
      setPhase("auth_blocked");
    }
  }, []);

  useEffect(() => {
    bootAuth();
  }, [bootAuth]);

  const handleAuthResolved = useCallback(
    (opts: { isAnonymous: boolean; displayName?: string }) => {
      if (typeof window !== "undefined") sessionStorage.setItem(PLAY_CHOICE_KEY, "true");
      setShowAuth(false);
      setPhase("ready");
      if (!opts.displayName && opts.isAnonymous) return; // plain guest
      if (opts.displayName) setDisplayName(opts.displayName);
      setHasProfile(true);
      // Logging in swaps the guest session for the account's own user.
      supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
      // Someone who finished as a guest and then made an account still gets
      // today's result on the board.
      const s = localSave.get();
      if (s.daily && s.daily.date === today && s.daily.finishedMs !== null) {
        submitDaily(s.daily.words.length, s.daily.hints, s.daily.finishedMs);
      }
    },
    [today, submitDaily]
  );

  // ---- Daily -------------------------------------------------------------

  const startDaily = () => setSave(localSave.startDaily(today));

  const finishDaily = (words: string[], hints: number) => {
    if (!progress) return;
    const timeMs = Math.max(1, Date.now() - progress.startedAt);
    const perfect = words.length === daily.par && hints === 0;
    const prevUnlocked = save.unlockedAchievements;
    let updated = localSave.recordDailyWin(today, timeMs, perfect);

    const newIds = diffNewlyUnlocked(updated, prevUnlocked);
    if (newIds.length > 0) {
      updated = localSave.setUnlockedAchievements([...prevUnlocked, ...newIds]);
      setNewlyUnlocked(ACHIEVEMENTS.filter((a) => newIds.includes(a.id)));
    }
    setSave(updated);
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 1800);
    if (hasProfile) submitDaily(words.length, hints, timeMs);
  };

  const addDailyWord = (word: string, viaHint = false) => {
    if (!progress) return;
    const words = [...progress.words, word];
    const hintAt = viaHint ? [...progress.hintAt, words.length - 1] : progress.hintAt;
    const hints = viaHint ? progress.hints + 1 : progress.hints;
    setSave(localSave.updateDaily({ words, hintAt, hints }));
    if (word === daily.target) finishDaily(words, hints);
  };

  const undoDaily = () => {
    if (!progress || progress.words.length === 0) return;
    const words = progress.words.slice(0, -1);
    setSave(localSave.updateDaily({ words, hintAt: progress.hintAt.filter((i) => i < words.length) }));
  };

  const hintDaily = () => {
    if (!progress) return;
    const from = progress.words.length ? progress.words[progress.words.length - 1] : daily.start;
    const next = nextBestWord(from, daily.target, daily.length, [daily.start, ...progress.words]);
    if (next) addDailyWord(next, true);
  };

  const handleShare = async () => {
    if (!progress || progress.finishedMs === null) return;
    const text = buildShareText({
      date: today,
      start: daily.start,
      target: daily.target,
      par: daily.par,
      words: progress.words,
      hints: progress.hints,
      timeMs: progress.finishedMs,
    });
    const result = await shareResult(text);
    setShareState(result);
    setTimeout(() => setShareState("idle"), 2200);
  };

  // ---- Classic Unlimited ---------------------------------------------------

  const newUnlimited = (length: WordLength = uLength) => {
    setUnlimited(getRandomPuzzle(length));
    setUWords([]);
    setUHintAt([]);
    setUHints(0);
    setUGaveUp(false);
    setUStartedAt(Date.now());
    setUFinishedMs(null);
  };

  const pickLength = (length: WordLength) => {
    if (length === uLength) return;
    setULength(length);
    setSave(localSave.setLastUnlimitedLength(length));
    newUnlimited(length);
  };

  const addUnlimitedWord = (word: string, viaHint = false) => {
    const words = [...uWords, word];
    setUWords(words);
    if (viaHint) {
      setUHintAt((h) => [...h, words.length - 1]);
      setUHints((h) => h + 1);
    }
    if (word === unlimited.target) setUFinishedMs(Math.max(1, Date.now() - uStartedAt));
  };

  const undoUnlimited = () => {
    const words = uWords.slice(0, -1);
    setUWords(words);
    setUHintAt((h) => h.filter((i) => i < words.length));
  };

  const hintUnlimited = () => {
    const from = uWords.length ? uWords[uWords.length - 1] : unlimited.start;
    const next = nextBestWord(from, unlimited.target, unlimited.length, [unlimited.start, ...uWords]);
    if (next) addUnlimitedWord(next, true);
  };

  const handleUnlock = () => {
    // Stub — no payment processor wired up yet. Replace with a real
    // server-verified purchase flow before this ever ships.
    alert("Payments aren't set up yet — Classic Unlimited will unlock for $2 once that's wired in.");
  };

  const locked = mode === "unlimited" && !save.unlockedUnlimited;

  // ---- Screens -------------------------------------------------------------

  if (phase === "auth_checking") {
    return (
      <div className="min-h-screen bg-ink text-paper flex items-center justify-center">
        <WordmarkTiles />
      </div>
    );
  }

  if (phase === "auth_blocked") {
    return (
      <div className="min-h-screen bg-ink text-paper flex flex-col items-center justify-center gap-4 px-4 text-center">
        <WifiOff className="w-8 h-8 text-danger" />
        <p className="text-sm text-muted max-w-xs">
          {authBlockedReason === "anonymous_disabled"
            ? "Guest play is temporarily unavailable for this game. Please try again shortly."
            : "Couldn't connect right now. Check your connection and try again."}
        </p>
        <button
          type="button"
          onClick={bootAuth}
          className="px-4 py-2 rounded-md bg-correct hover:bg-correct-dim text-paper text-sm font-medium transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (phase === "choice") {
    return <AuthModal currentDisplayName={displayName} onResolved={handleAuthResolved} />;
  }

  const showTimer = mode === "daily" ? !!progress : !locked;
  const timerValue = mode === "daily" ? dailyTime : unlimitedTime;
  const modalOpen = showAuth || showAchievements;

  return (
    <div className="min-h-screen bg-ink text-paper flex flex-col items-center px-4 py-6 gap-5">
      <header className="w-full max-w-xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Phones need the room for the timer and streak. */}
          <WordmarkTiles className="hidden sm:flex" />
          <h1 className="font-display font-semibold text-lg truncate">
            {/* Full name for search engines and wider screens; phones show
                "Ladder" so the timer and streak still fit beside it. */}
            <span className="sr-only sm:not-sr-only">Wordezy </span>Ladder
          </h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {showTimer && (
            <div className="flex items-center gap-1.5 text-sm text-paper/80 font-mono" aria-label="Time">
              <TimerIcon className="w-4 h-4" />
              {formatTime(timerValue)}
            </div>
          )}
          {save.streak > 0 && (
            <div className="flex items-center gap-1 text-sm text-present font-mono" title="Daily streak">
              <Flame className="w-4 h-4" />
              {save.streak}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowAchievements(true)}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-paper transition-colors"
            aria-label="Achievements"
          >
            <Award className="w-4 h-4" />
            {save.unlockedAchievements.length}/{ACHIEVEMENTS.length}
          </button>
        </div>
      </header>

      {showConfetti && <Confetti durationMs={1800} />}
      {newlyUnlocked && newlyUnlocked.length > 0 && (
        <AchievementToastStack achievements={newlyUnlocked} onDone={() => setNewlyUnlocked(null)} />
      )}
      {showAchievements && <AchievementsModal save={save} onClose={() => setShowAchievements(false)} />}
      {showAuth && <AuthModal currentDisplayName={displayName} onResolved={handleAuthResolved} />}

      <div className="flex items-center gap-1 p-1 bg-surface border border-rule rounded-lg">
        <button
          type="button"
          onClick={() => setMode("daily")}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            mode === "daily" ? "bg-correct text-paper" : "text-muted hover:text-paper"
          }`}
        >
          Daily
        </button>
        <button
          type="button"
          onClick={() => {
            // Start an untouched ladder's clock when the player actually opens it.
            if (mode !== "unlimited" && uWords.length === 0 && uHints === 0) setUStartedAt(Date.now());
            setMode("unlimited");
          }}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            mode === "unlimited" ? "bg-correct text-paper" : "text-muted hover:text-paper"
          }`}
        >
          {!save.unlockedUnlimited && <Lock className="w-3.5 h-3.5" />}
          Classic Unlimited
        </button>
      </div>

      <main className="w-full max-w-xl flex flex-col items-center gap-6">
        {mode === "daily" && !progress && (
          <section className="w-full bg-surface border border-rule rounded-xl p-6 text-center space-y-5 animate-rise-in">
            <div className="space-y-1.5">
              <p className="text-xs font-mono text-muted uppercase tracking-wide">
                {new Date(today + "T00:00:00Z").toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: "UTC",
                })}
              </p>
              <h2 className="font-display font-semibold text-2xl">Today's ladder</h2>
              <p className="text-sm text-muted">
                Climb from one 4-letter word to another, changing one letter at a time. Par today is{" "}
                <span className="text-paper font-mono">{daily.par} moves</span>.
              </p>
            </div>
            <ul className="text-sm text-paper/80 space-y-2 text-left max-w-xs mx-auto">
              <li className="flex items-start gap-2.5">
                <Footprints className="w-4 h-4 mt-0.5 text-correct shrink-0" />
                Every step must be a real word, one letter different from the last.
              </li>
              <li className="flex items-start gap-2.5">
                <Keyboard className="w-4 h-4 mt-0.5 text-correct shrink-0" />
                Type or tap your word, then press Enter. Undo a step any time.
              </li>
              <li className="flex items-start gap-2.5">
                <Lightbulb className="w-4 h-4 mt-0.5 text-present shrink-0" />
                Stuck? A hint fills in the best next word but costs an extra move.
              </li>
            </ul>
            <button
              type="button"
              onClick={startDaily}
              className="inline-flex items-center justify-center gap-2 w-full max-w-xs py-3 rounded-lg bg-correct hover:bg-correct-dim text-paper font-medium transition-colors"
            >
              <Play className="w-4 h-4" />
              Play — the clock starts now
            </button>
            {save.bestDailyTimeMs !== null && (
              <p className="text-xs font-mono text-muted">Your best time: {formatTime(save.bestDailyTimeMs)}</p>
            )}
          </section>
        )}

        {mode === "daily" && progress && !dailyDone && (
          <LadderBoard
            puzzle={daily}
            words={progress.words}
            hintAt={progress.hintAt}
            hints={progress.hints}
            active={!modalOpen}
            onAdd={(w) => addDailyWord(w)}
            onUndo={undoDaily}
            onHint={hintDaily}
            hintLabel="Hint +1 move"
          />
        )}

        {mode === "daily" && progress && dailyDone && (
          <>
            <DailyResult
              puzzle={daily}
              progress={progress}
              streak={save.streak}
              shareState={shareState}
              onShare={handleShare}
              scoreStatus={scoreStatus}
              hasProfile={hasProfile}
              onJoin={() => setShowAuth(true)}
            />
            <Leaderboard date={today} par={daily.par} currentPlayerId={userId} refreshKey={leaderboardKey} />
          </>
        )}

        {locked && (
          <section className="w-full max-w-sm bg-surface border border-rule rounded-xl p-6 text-center space-y-4 mt-4">
            <div className="w-12 h-12 rounded-full bg-present-soft border border-present-dim/50 flex items-center justify-center text-present mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-lg">Classic Unlimited</h2>
              <p className="text-sm text-muted mt-1.5">
                Unlock endless ladders in 4 or 5 letters — free hints, see the best route any time, play as many as you want.
              </p>
            </div>
            <button
              type="button"
              onClick={handleUnlock}
              className="w-full py-2.5 px-4 rounded-md bg-correct hover:bg-correct-dim text-paper font-medium text-sm transition-colors"
            >
              Unlock for $2
            </button>
          </section>
        )}

        {mode === "unlimited" && !locked && (
          <div className="flex items-center gap-1 p-1 bg-surface border border-rule rounded-lg -mt-1" role="group" aria-label="Word length">
            {([4, 5] as WordLength[]).map((len) => (
              <button
                key={len}
                type="button"
                onClick={() => pickLength(len)}
                className={`px-3.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  uLength === len ? "bg-present text-ink" : "text-muted hover:text-paper"
                }`}
              >
                {len} letters
              </button>
            ))}
          </div>
        )}

        {mode === "unlimited" && !locked && !unlimitedDone && (
          <LadderBoard
            key={unlimited.id}
            puzzle={unlimited}
            words={uWords}
            hintAt={uHintAt}
            hints={uHints}
            active={!modalOpen}
            onAdd={(w) => addUnlimitedWord(w)}
            onUndo={undoUnlimited}
            onHint={hintUnlimited}
            hintLabel="Hint"
            onShowRoute={() => setUGaveUp(true)}
          />
        )}

        {mode === "unlimited" && !locked && unlimitedDone && (
          <section className="w-full bg-surface border border-rule rounded-xl p-6 text-center space-y-4 animate-rise-in">
            {uGaveUp && uFinishedMs === null ? (
              <p className="text-xs font-mono text-muted uppercase tracking-wide">A shortest route</p>
            ) : (
              <>
                <p className="text-xs font-mono text-muted uppercase tracking-wide">Climbed in {formatTime(uFinishedMs ?? 0)}</p>
                <p className="font-mono text-3xl text-correct">
                  {uWords.length + uHints} moves <span className="text-base text-muted">· par {unlimited.par}</span>
                </p>
                <p className="text-xs font-mono text-muted uppercase tracking-wide pt-2">A shortest route</p>
              </>
            )}
            <RouteLine route={unlimited.route} />
            <button
              type="button"
              onClick={() => newUnlimited()}
              className="inline-flex items-center justify-center gap-2 w-full max-w-xs py-2.5 rounded-lg bg-correct hover:bg-correct-dim text-paper font-medium text-sm transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              New ladder
            </button>
          </section>
        )}
      </main>

      <footer className="w-full max-w-xl mt-auto pt-6 border-t border-rule/60 text-center space-y-2">
        <p className="text-xs text-muted">More free games on bgameworld</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          {OTHER_GAMES.map((g) => (
            <a key={g.url} href={g.url} className="text-paper/80 hover:text-correct transition-colors">
              {g.name}
            </a>
          ))}
          <a href="https://bgameworld.com/" className="text-muted hover:text-paper transition-colors">
            All games
          </a>
        </nav>
      </footer>
    </div>
  );
};

const DailyResult: React.FC<{
  puzzle: Puzzle;
  progress: DailyProgress;
  streak: number;
  shareState: "idle" | "shared" | "copied" | "failed";
  onShare: () => void;
  scoreStatus: "idle" | "saving" | "saved" | "failed";
  hasProfile: boolean;
  onJoin: () => void;
}> = ({ puzzle, progress, streak, shareState, onShare, scoreStatus, hasProfile, onJoin }) => {
  const [countdown, setCountdown] = useState(() => msUntilNextPuzzle());
  useEffect(() => {
    const id = setInterval(() => setCountdown(msUntilNextPuzzle()), 1000);
    return () => clearInterval(id);
  }, []);
  const moves = progress.words.length + progress.hints;
  const verdict =
    moves < puzzle.par
      ? "Under par — brilliant"
      : moves === puzzle.par && progress.hints === 0
      ? "Right on par — a perfect climb"
      : moves === puzzle.par
      ? "On par, with a little help"
      : `${moves - puzzle.par} over par`;

  return (
    <section className="w-full bg-surface border border-rule rounded-xl p-6 space-y-5 animate-rise-in">
      <div className="text-center space-y-1">
        <p className="text-xs font-mono text-muted uppercase tracking-wide">
          {puzzle.start.toUpperCase()} → {puzzle.target.toUpperCase()}
        </p>
        <p className="font-mono text-4xl text-correct">
          {moves} <span className="text-lg">moves</span>
        </p>
        <p className="text-xs text-muted">
          {verdict} · {formatTime(progress.finishedMs ?? 0)}
          {progress.hints > 0 ? ` · ${progress.hints} hint${progress.hints === 1 ? "" : "s"}` : ""}
          {streak > 1 ? ` · ${streak}-day streak` : ""}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-mono text-muted uppercase tracking-wide flex items-center gap-1.5">
          <Route className="w-3.5 h-3.5" />
          Your climb
        </p>
        <RouteLine route={[puzzle.start, ...progress.words]} />
        {moves > puzzle.par && (
          <>
            <p className="text-[11px] font-mono text-muted uppercase tracking-wide pt-2">A {puzzle.par}-move route</p>
            <RouteLine route={puzzle.route} />
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onShare}
        className="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-correct hover:bg-correct-dim text-paper font-medium text-sm transition-colors"
      >
        {shareState === "copied" ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
        {shareState === "copied" ? "Copied — paste it anywhere" : shareState === "failed" ? "Couldn't copy — try again" : "Share result"}
      </button>

      <div className="text-center space-y-1.5">
        <p className="text-xs font-mono text-muted">Next ladder in {formatCountdown(countdown)}</p>
        {!hasProfile ? (
          <button type="button" onClick={onJoin} className="text-xs text-correct hover:underline">
            Create a free account to put today's climb on the leaderboard
          </button>
        ) : scoreStatus === "failed" ? (
          <p className="text-xs text-muted">Saved on this device — the leaderboard couldn't be reached.</p>
        ) : null}
      </div>
    </section>
  );
};
