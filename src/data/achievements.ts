// Achievement definitions — computed from the per-device SaveData, so
// unlocking one doesn't require an account.
import type { SaveData } from "../lib/localSave.ts";

export interface Achievement {
  id: string;
  title: string;
  description: string;
  /** lucide-react icon name, resolved by the component that renders these. */
  icon: "Star" | "Flame" | "Zap" | "Gauge" | "Target" | "Trophy";
  isUnlocked: (save: SaveData) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_win",
    title: "First Climb",
    description: "Finish your first daily ladder.",
    icon: "Star",
    isUnlocked: (s) => s.totalDailyWins >= 1,
  },
  {
    id: "perfect",
    title: "Hole in One",
    description: "Finish a daily ladder at par with no hints.",
    icon: "Target",
    isUnlocked: (s) => s.perfectWins >= 1,
  },
  {
    id: "streak_3",
    title: "On a Roll",
    description: "Reach a 3-day streak.",
    icon: "Flame",
    isUnlocked: (s) => s.maxStreak >= 3,
  },
  {
    id: "streak_7",
    title: "Week Streak",
    description: "Reach a 7-day streak.",
    icon: "Flame",
    isUnlocked: (s) => s.maxStreak >= 7,
  },
  {
    id: "streak_30",
    title: "Unstoppable",
    description: "Reach a 30-day streak.",
    icon: "Flame",
    isUnlocked: (s) => s.maxStreak >= 30,
  },
  {
    id: "speed_60",
    title: "Quick Climber",
    description: "Finish a daily ladder in under a minute.",
    icon: "Gauge",
    isUnlocked: (s) => s.bestDailyTimeMs !== null && s.bestDailyTimeMs < 60_000,
  },
  {
    id: "speed_30",
    title: "Lightning Steps",
    description: "Finish a daily ladder in under 30 seconds.",
    icon: "Zap",
    isUnlocked: (s) => s.bestDailyTimeMs !== null && s.bestDailyTimeMs < 30_000,
  },
  {
    id: "dedicated_25",
    title: "Dedicated",
    description: "Finish 25 daily ladders.",
    icon: "Trophy",
    isUnlocked: (s) => s.totalDailyWins >= 25,
  },
];

/** Ids of achievements newly true in `save` that weren't already unlocked. */
export function diffNewlyUnlocked(save: SaveData, prevUnlockedIds: string[]): string[] {
  const prev = new Set(prevUnlockedIds);
  return ACHIEVEMENTS.filter((a) => !prev.has(a.id) && a.isUnlocked(save)).map((a) => a.id);
}
