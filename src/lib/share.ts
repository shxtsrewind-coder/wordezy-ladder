import { formatTime } from "../hooks/useTimer.ts";

export const GAME_URL = "https://wordezyladder.bgameworld.com/";

/** Spoiler-free result: one row per word on the ladder, green where a letter
 *  already matches the target — friends see the shape of the climb, not the
 *  words. Start and target aren't spoilers; every player sees them at once. */
export function buildShareText(opts: {
  date: string;
  start: string;
  target: string;
  par: number;
  words: string[];
  hints: number;
  timeMs: number;
}): string {
  const pretty = new Date(opts.date + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const moves = opts.words.length + opts.hints;
  const rows = opts.words
    .map((w) => w.split("").map((ch, i) => (ch === opts.target[i] ? "🟩" : "⬛")).join(""))
    .join("\n");
  const verdict = moves === opts.par && opts.hints === 0 ? "par ⛳" : moves < opts.par ? "under par!" : `par ${opts.par}`;
  const hintNote = opts.hints > 0 ? `, ${opts.hints} hint${opts.hints === 1 ? "" : "s"}` : "";
  return (
    `Wordezy Ladder · ${pretty}\n` +
    `${opts.start.toUpperCase()} → ${opts.target.toUpperCase()}\n` +
    `${moves} moves (${verdict}${hintNote}) · ⏱ ${formatTime(opts.timeMs)}\n` +
    `${rows}\n${GAME_URL}`
  );
}

/** Opens the native share sheet where there is one (phones), otherwise
 *  copies to the clipboard. Resolves to what happened, for the button label. */
export async function shareResult(text: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (typeof navigator !== "undefined" && navigator.share && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      await navigator.share({ text });
      return "shared";
    }
  } catch (err) {
    // The player closing the share sheet isn't a failure worth reporting.
    if ((err as { name?: string })?.name === "AbortError") return "shared";
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
