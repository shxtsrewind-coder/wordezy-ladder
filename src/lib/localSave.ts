// Local save for what's inherently per-device: today's ladder in progress,
// the win streak, the Classic Unlimited unlock flag, and the stats
// achievements are computed from. Identity and leaderboard standing live in
// Supabase (lib/supabase.ts ensureSession + lib/leaderboard.ts).
import type { WordLength } from "./ladder.ts";

const KEY = "wordezyLadder.save.v1";

/** Today's daily climb. Kept in storage so a reload mid-puzzle neither resets
 *  the clock nor loses the words already on the ladder. */
export interface DailyProgress {
  date: string;
  /** Wall-clock start (ms since epoch), set when the player presses Play. */
  startedAt: number;
  /** Words entered after the start word, in order (the target last, once reached). */
  words: string[];
  /** Positions in `words` that a hint filled in (shown in gold). */
  hintAt: number[];
  /** Hints used — each adds one move. Undoing a hinted word keeps the cost. */
  hints: number;
  /** Final time once the target is reached. */
  finishedMs: number | null;
}

export interface SaveData {
  lastSolvedDate: string | null;
  streak: number;
  maxStreak: number;
  totalDailyWins: number;
  /** Daily wins at par with no hints. */
  perfectWins: number;
  bestDailyTimeMs: number | null;
  unlockedUnlimited: boolean;
  lastUnlimitedLength: WordLength;
  displayName: string | null;
  unlockedAchievements: string[];
  daily: DailyProgress | null;
}

const DEFAULTS: SaveData = {
  lastSolvedDate: null,
  streak: 0,
  maxStreak: 0,
  totalDailyWins: 0,
  perfectWins: 0,
  bestDailyTimeMs: null,
  unlockedUnlimited: false,
  lastUnlimitedLength: 4,
  displayName: null,
  unlockedAchievements: [],
  daily: null,
};

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable (private mode, etc.) */
  }
}

export const localSave = {
  get: read,

  startDaily(date: string): SaveData {
    const data = read();
    data.daily = { date, startedAt: Date.now(), words: [], hintAt: [], hints: 0, finishedMs: null };
    write(data);
    return data;
  },

  updateDaily(patch: Partial<DailyProgress>): SaveData {
    const data = read();
    if (data.daily) data.daily = { ...data.daily, ...patch };
    write(data);
    return data;
  },

  /** Records a finished daily: streak, stats and best time. Counts once per
   *  calendar day. */
  recordDailyWin(date: string, timeMs: number, perfect: boolean): SaveData {
    const data = read();
    if (data.daily && data.daily.date === date) data.daily.finishedMs = timeMs;

    if (data.lastSolvedDate !== date) {
      const yesterday = new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
      data.streak = data.lastSolvedDate === yesterday ? data.streak + 1 : 1;
      data.lastSolvedDate = date;
      data.maxStreak = Math.max(data.maxStreak, data.streak);
      data.totalDailyWins += 1;
      if (perfect) data.perfectWins += 1;
      data.bestDailyTimeMs = data.bestDailyTimeMs === null ? timeMs : Math.min(data.bestDailyTimeMs, timeMs);
    }
    write(data);
    return data;
  },

  setLastUnlimitedLength(length: WordLength): SaveData {
    const data = read();
    data.lastUnlimitedLength = length;
    write(data);
    return data;
  },

  setUnlockedAchievements(ids: string[]): SaveData {
    const data = read();
    data.unlockedAchievements = ids;
    write(data);
    return data;
  },

  /** Placeholder until a real payment processor is wired up — never call
   *  this from anywhere except a confirmed, server-verified purchase. */
  setUnlocked(value: boolean): SaveData {
    const data = read();
    data.unlockedUnlimited = value;
    write(data);
    return data;
  },

  setDisplayName(name: string): SaveData {
    const data = read();
    data.displayName = name.trim().slice(0, 20) || null;
    write(data);
    return data;
  },
};
