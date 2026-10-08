import { VALID_4, CORE_4, ENDS_4, VALID_5, CORE_5, ENDS_5 } from "../data/words.ts";
import { makeRng } from "./rng.ts";

export type WordLength = 4 | 5;

export interface Puzzle {
  /** UTC date for the daily ladder, or a unique seed for an Unlimited one. */
  id: string;
  length: WordLength;
  start: string;
  target: string;
  /** Fewest moves possible — the length of the shortest route. */
  par: number;
  /** One shortest route, start and target included (shown after solving). */
  route: string[];
}

/** Lazily built word web for one word length: which words are one letter
 *  apart, found through shared "wildcard" patterns (c_ld matches cold, cord). */
class WordWeb {
  /** Every word a player may type. */
  readonly valid: Set<string>;
  readonly ends: string[];
  /** Routes, par and hints only use everyday ("core") words. */
  private buckets = new Map<string, string[]>();

  constructor(validList: string, coreList: string, endsList: string) {
    this.valid = new Set(validList.split(" "));
    this.ends = endsList.split(" ");
    for (const w of coreList.split(" ")) {
      for (const key of patterns(w)) {
        const list = this.buckets.get(key);
        if (list) list.push(w);
        else this.buckets.set(key, [w]);
      }
    }
  }

  neighbours(word: string): string[] {
    const out: string[] = [];
    for (const key of patterns(word)) {
      for (const w of this.buckets.get(key) ?? []) if (w !== word) out.push(w);
    }
    return out;
  }

  /** Breadth-first distances from `from` to every reachable word. */
  distancesFrom(from: string): Map<string, number> {
    const dist = new Map<string, number>([[from, 0]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const w = queue[i];
      const d = dist.get(w)!;
      for (const nb of this.neighbours(w)) {
        if (!dist.has(nb)) {
          dist.set(nb, d + 1);
          queue.push(nb);
        }
      }
    }
    return dist;
  }

  /** A shortest route from `from` to `to` (both included), or null. */
  shortestRoute(from: string, to: string): string[] | null {
    if (from === to) return [from];
    const prev = new Map<string, string>();
    const seen = new Set([from]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const w = queue[i];
      for (const nb of this.neighbours(w)) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        prev.set(nb, w);
        if (nb === to) {
          const route = [to];
          let cur = to;
          while (cur !== from) {
            cur = prev.get(cur)!;
            route.push(cur);
          }
          return route.reverse();
        }
        queue.push(nb);
      }
    }
    return null;
  }
}

function patterns(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) out.push(word.slice(0, i) + "_" + word.slice(i + 1));
  return out;
}

const webs: Partial<Record<WordLength, WordWeb>> = {};
export function web(length: WordLength): WordWeb {
  if (!webs[length]) {
    webs[length] = length === 4 ? new WordWeb(VALID_4, CORE_4, ENDS_4) : new WordWeb(VALID_5, CORE_5, ENDS_5);
  }
  return webs[length]!;
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Par ranges: long enough to be a puzzle, short enough to finish over coffee. */
const PAR_CHOICES: Record<WordLength, number[]> = {
  // Weighted: 5 moves is the sweet spot, 4 and 6 for variety.
  4: [4, 4, 5, 5, 5, 6, 6],
  5: [4, 5, 5, 6, 6, 7],
};

function buildPuzzle(id: string, length: WordLength, rng: () => number): Puzzle {
  const w = web(length);
  for (let attempt = 0; attempt < 400; attempt++) {
    const start = w.ends[Math.floor(rng() * w.ends.length)];
    const wantPar = PAR_CHOICES[length][Math.floor(rng() * PAR_CHOICES[length].length)];
    const dist = w.distancesFrom(start);
    const targets = w.ends.filter((t) => dist.get(t) === wantPar);
    if (targets.length === 0) continue;
    const target = targets[Math.floor(rng() * targets.length)];
    const route = w.shortestRoute(start, target)!;
    return { id, length, start, target, par: route.length - 1, route };
  }
  // Unreachable with the shipped lists (the generator script checks the
  // web is connected), but never leave a player without a puzzle.
  const route = ["cold", "cord", "word", "ward", "warm"];
  return { id, length: 4, start: "cold", target: "warm", par: 4, route };
}

/** The same ladder for every player on a given UTC day. Always 4 letters. */
export function getDailyPuzzle(date: string = todayUtc()): Puzzle {
  return buildPuzzle(date, 4, makeRng(`ladder:daily:${date}`));
}

/** Classic Unlimited: a fresh ladder of the chosen length every time. */
export function getRandomPuzzle(length: WordLength): Puzzle {
  const seed = `ladder:random:${length}:${Date.now()}:${Math.random()}`;
  return buildPuzzle(seed, length, makeRng(seed));
}

export type StepError = "length" | "not_word" | "one_letter" | "used";

export const STEP_ERROR_TEXT: Record<StepError, string> = {
  length: "Fill in every letter first",
  not_word: "Not in the word list",
  one_letter: "Change exactly one letter",
  used: "You've already used that word",
};

/** Checks a typed word against the last word on the ladder. */
export function checkStep(word: string, previous: string, ladder: string[], length: WordLength): StepError | null {
  if (word.length !== length) return "length";
  let changed = 0;
  for (let i = 0; i < length; i++) if (word[i] !== previous[i]) changed++;
  if (changed !== 1) return "one_letter";
  if (!web(length).valid.has(word)) return "not_word";
  if (ladder.includes(word)) return "used";
  return null;
}

/** The best next word from where the player is now (for hints). */
export function nextBestWord(from: string, target: string, length: WordLength, avoid: string[]): string | null {
  const w = web(length);
  const toTarget = w.distancesFrom(target);
  // Works from any word, even a rarer one the player typed that isn't in the
  // everyday web: pick its neighbour that's closest to the target.
  let bestWord: string | null = null;
  let bestDist = Infinity;
  for (const nb of w.neighbours(from)) {
    const d = toTarget.get(nb);
    if (d === undefined || avoid.includes(nb)) continue;
    if (d < bestDist) {
      bestDist = d;
      bestWord = nb;
    }
  }
  return bestWord;
}

/** Milliseconds until the next daily puzzle (midnight UTC). */
export function msUntilNextPuzzle(now: number = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}
