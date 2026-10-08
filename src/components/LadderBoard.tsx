import React, { useCallback, useEffect, useRef, useState } from "react";
import { Delete, CornerDownLeft, Undo2, Lightbulb, Route, CircleDot, Flag } from "lucide-react";
import { checkStep, STEP_ERROR_TEXT, type Puzzle } from "../lib/ladder.ts";

const KEY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "BACKSPACE"],
];

interface Props {
  puzzle: Puzzle;
  /** Words entered after the start word. */
  words: string[];
  /** Positions in `words` filled in by a hint. */
  hintAt: number[];
  hints: number;
  /** Whether keyboard input is accepted (false behind modals, when finished). */
  active: boolean;
  onAdd: (word: string) => void;
  onUndo: () => void;
  onHint: () => void;
  hintLabel: string;
  /** Unlimited only: reveal a shortest route and end this ladder. */
  onShowRoute?: () => void;
}

/** Tile size: five tiles plus the row labels fit a 320px phone; capped on desktop. */
const TILE = "min(11vw, 3.1rem)";
const FONT = "min(6vw, 1.45rem)";

const Tile: React.FC<{ letter: string; tone: string; className?: string }> = ({ letter, tone, className = "" }) => (
  <span
    className={`rounded-[6px] border-2 flex items-center justify-center font-display font-semibold uppercase ${tone} ${className}`}
    style={{ width: TILE, height: TILE, fontSize: FONT }}
  >
    {letter}
  </span>
);

/** One ladder rung: green where a letter already matches the target, and a
 *  gold edge on the letter that changed from the rung above. */
const Rung: React.FC<{ word: string; previous: string | null; target: string; hinted?: boolean; isTarget?: boolean }> = ({
  word,
  previous,
  target,
  hinted,
  isTarget,
}) => (
  <div className="flex items-center gap-[5px]">
    {word.split("").map((ch, i) => {
      const match = ch === target[i];
      const changed = previous !== null && previous[i] !== ch;
      const tone = isTarget
        ? "bg-correct border-correct text-ink"
        : match
        ? `bg-correct border-correct text-ink ${changed ? "ring-2 ring-present ring-offset-2 ring-offset-ink" : ""}`
        : changed
        ? "bg-surface-high border-present text-paper"
        : "bg-surface-high border-rule text-paper";
      return <Tile key={i} letter={ch} tone={tone} />;
    })}
    {hinted && <Lightbulb className="w-4 h-4 text-present ml-1 shrink-0" aria-label="Filled in by a hint" />}
  </div>
);

export const LadderBoard: React.FC<Props> = ({ puzzle, words, hintAt, hints, active, onAdd, onUndo, onHint, hintLabel, onShowRoute }) => {
  const n = puzzle.length;
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const inputRowRef = useRef<HTMLDivElement>(null);

  const last = words.length > 0 ? words[words.length - 1] : puzzle.start;
  const done = last === puzzle.target;
  const moves = words.length + hints;

  // Keep the row being typed in view as the ladder grows on a phone.
  useEffect(() => {
    inputRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [words.length]);

  const flashError = useCallback((msg: string) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 420);
  }, []);

  const submit = useCallback(() => {
    if (done) return;
    const word = typed.toLowerCase();
    const problem = checkStep(word, last, [puzzle.start, ...words], n);
    if (problem) {
      flashError(STEP_ERROR_TEXT[problem]);
      return;
    }
    setTyped("");
    setError(null);
    onAdd(word);
  }, [done, typed, last, puzzle.start, words, n, flashError, onAdd]);

  const press = useCallback(
    (key: string) => {
      if (!active || done) return;
      if (key === "ENTER") return submit();
      if (key === "BACKSPACE") {
        setTyped((t) => t.slice(0, -1));
        setError(null);
        return;
      }
      if (/^[A-Z]$/.test(key)) {
        setTyped((t) => (t.length < n ? t + key : t));
        setError(null);
      }
    },
    [active, done, submit, n]
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        press("ENTER");
      } else if (e.key === "Backspace") {
        e.preventDefault();
        press("BACKSPACE");
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        press(e.key.toUpperCase());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, press]);

  const handleUndo = () => {
    setTyped("");
    setError(null);
    onUndo();
  };

  return (
    <div className="w-full flex flex-col items-center gap-5 select-none">
      <div className="flex items-center gap-3 text-xs font-mono uppercase tracking-wide">
        <span className={moves > puzzle.par ? "text-present" : "text-paper/80"}>
          {moves} {moves === 1 ? "move" : "moves"}
        </span>
        <span className="text-faint">·</span>
        <span className="text-muted">par {puzzle.par}</span>
        {hints > 0 && (
          <>
            <span className="text-faint">·</span>
            <span className="text-present">
              {hints} hint{hints === 1 ? "" : "s"}
            </span>
          </>
        )}
      </div>

      <div className="flex flex-col items-center gap-[7px]" aria-label="Your ladder">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="w-8 sm:w-12 flex justify-end text-muted" title="Start word">
            <CircleDot className="w-4 h-4" aria-label="Start word" />
          </span>
          <Rung word={puzzle.start} previous={null} target={puzzle.target} />
          <span className="w-8 sm:w-12" />
        </div>

        {words.map((w, i) => (
          <div key={i} className="flex items-center gap-1.5 sm:gap-2 animate-rise-in">
            <span className="w-8 sm:w-12 text-right text-[10px] font-mono text-faint">{i + 1}</span>
            <Rung
              word={w}
              previous={i === 0 ? puzzle.start : words[i - 1]}
              target={puzzle.target}
              hinted={hintAt.includes(i)}
              isTarget={w === puzzle.target}
            />
            <span className="w-8 sm:w-12" />
          </div>
        ))}

        {!done && (
          <div ref={inputRowRef} className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="w-8 sm:w-12 text-right text-[10px] font-mono text-faint">{words.length + 1}</span>
              <div className={`flex items-center gap-[5px] ${shake ? "animate-shake" : ""}`} aria-live="polite" aria-label={`Typing: ${typed || "empty"}`}>
                {Array.from({ length: n }, (_, i) => {
                  const ch = typed[i];
                  const tone = error
                    ? "bg-danger-soft border-danger text-paper"
                    : ch
                    ? "bg-ink border-muted/70 text-paper"
                    : i === typed.length && active
                    ? "bg-ink border-paper/60 border-dashed text-transparent"
                    : "bg-ink border-rule border-dashed text-transparent";
                  return <Tile key={i} letter={ch ?? "·"} tone={tone} />;
                })}
              </div>
              <span className="w-8 sm:w-12" />
            </div>
            <p className={`h-4 text-xs ${error ? "text-danger" : "text-faint"}`}>
              {error ?? `Change one letter of ${last.toUpperCase()}`}
            </p>
          </div>
        )}

        {!done && (
          <div className="flex items-center gap-1.5 sm:gap-2 opacity-90">
            <span className="w-8 sm:w-12 flex justify-end text-correct" title="Target word">
              <Flag className="w-4 h-4" aria-label="Target word" />
            </span>
            <div className="flex items-center gap-[5px]">
              {puzzle.target.split("").map((ch, i) => (
                <Tile key={i} letter={ch} tone="bg-correct-soft border-correct-dim text-correct" />
              ))}
            </div>
            <span className="w-8 sm:w-12" />
          </div>
        )}
      </div>

      {!done && (
        <>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleUndo}
              disabled={words.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-rule bg-surface text-sm text-paper/90 hover:border-muted/60 transition-colors disabled:opacity-40"
            >
              <Undo2 className="w-4 h-4" />
              Undo step
            </button>
            <button
              type="button"
              onClick={() => {
                setTyped("");
                setError(null);
                onHint();
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-present-dim/50 bg-present-soft text-sm text-present hover:border-present transition-colors"
            >
              <Lightbulb className="w-4 h-4" />
              {hintLabel}
            </button>
            {onShowRoute && (
              <button
                type="button"
                onClick={onShowRoute}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-rule bg-surface text-sm text-muted hover:text-paper transition-colors"
              >
                <Route className="w-4 h-4" />
                Show route
              </button>
            )}
          </div>

          <div className="w-full max-w-md flex flex-col gap-1.5" role="group" aria-label="Keyboard">
            {KEY_ROWS.map((row, r) => (
              <div key={r} className="flex justify-center gap-1.5">
                {row.map((key) => {
                  const wide = key === "ENTER" || key === "BACKSPACE";
                  const inTarget = puzzle.target.toUpperCase().includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => press(key)}
                      disabled={!active}
                      aria-label={key === "BACKSPACE" ? "Delete letter" : key === "ENTER" ? "Enter word" : key}
                      className={`${wide ? "flex-[1.5] text-[10px]" : "flex-1 text-sm"} h-12 rounded-md font-semibold flex items-center justify-center transition-transform active:scale-90 disabled:opacity-60 ${
                        key === "ENTER"
                          ? "bg-correct text-paper"
                          : inTarget
                          ? "bg-surface-high text-correct ring-1 ring-inset ring-correct-dim/60"
                          : "bg-surface-high text-paper hover:bg-rule"
                      }`}
                    >
                      {key === "BACKSPACE" ? <Delete className="w-4 h-4" /> : key === "ENTER" ? <CornerDownLeft className="w-4 h-4" /> : key}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
