// Daily leaderboard — backed by Supabase (the project shared with Wordezy,
// Wordezy Search and Wordezy Scramble; see supabase/migrations for the
// wordezy_ladder_* tables). Writes go through a SECURITY DEFINER RPC that
// reads the player's identity and display name from the session itself.
import { supabase } from "./supabase.ts";

export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  /** Moves = words entered + hints used. Fewer is better. */
  moves: number;
  hints: number;
  timeMs: number;
  isYou: boolean;
}

/** Records the signed-in player's finish for a puzzle date. Only the first
 *  finish of the day counts — the RPC ignores any later submission. */
export async function submitScore(opts: { puzzleDate: string; steps: number; hints: number; par: number; timeMs: number }): Promise<void> {
  const { error } = await supabase.rpc("submit_wordezy_ladder_score", {
    p_puzzle_date: opts.puzzleDate,
    p_steps: opts.steps,
    p_hints: opts.hints,
    p_par: opts.par,
    p_time_ms: Math.max(1, Math.round(opts.timeMs)),
  });
  if (error) throw error;
}

/** Returns this game's display name for the signed-in player, copying it
 *  over from the other Wordezy games the first time an existing account
 *  plays. Null for guests who haven't picked a name. */
export async function ensureProfile(): Promise<string | null> {
  const { data, error } = await supabase.rpc("wordezy_ladder_ensure_profile");
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Fewest moves first, fastest time as the tiebreaker. */
export async function getDailyLeaderboard(puzzleDate: string, currentPlayerId: string | null, limit = 10): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("wordezy_ladder_daily_leaderboard", {
    p_puzzle_date: puzzleDate,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []).map((row: { player_id: string; display_name: string; steps: number; hints: number; time_ms: number }) => ({
    playerId: row.player_id,
    displayName: row.display_name,
    moves: row.steps + row.hints,
    hints: row.hints,
    timeMs: row.time_ms,
    isYou: row.player_id === currentPlayerId,
  }));
}

export interface AllTimeLeaderboardEntry {
  playerId: string;
  displayName: string;
  wins: number;
  /** Daily ladders finished at (or under) par with no hints. */
  pars: number;
  isYou: boolean;
}

/** All-time standings: most daily finishes, then most perfect (par) climbs. */
export async function getAllTimeLeaderboard(currentPlayerId: string | null, limit = 10): Promise<AllTimeLeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("wordezy_ladder_alltime_leaderboard", { p_limit: limit });
  if (error) throw error;
  return (data ?? []).map((row: { player_id: string; display_name: string; wins: number; pars: number }) => ({
    playerId: row.player_id,
    displayName: row.display_name,
    wins: Number(row.wins),
    pars: Number(row.pars),
    isYou: row.player_id === currentPlayerId,
  }));
}
