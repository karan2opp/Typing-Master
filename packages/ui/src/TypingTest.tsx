import { memo, useEffect, useMemo, useRef, useState } from "react";
import { testActivity } from "./testActivity";
import {
  TypingSession,
  type Layout,
  type LogEntry,
  type TypingResult,
} from "@typing/engine";

export interface TypingTestProps {
  text: string;
  /** Time limit. For a words test this is only a safety cap. */
  durationMs: number;
  /** "time" shows a countdown; "words" shows words done out of the total. */
  mode: "time" | "words";
  layout: Layout;
  onFinish(result: TypingResult, log: readonly LogEntry[]): void;
  /** Called once, on the first keystroke. */
  onStart(): void;
  /** Start a fresh test with a new passage. Not offered (and Tab does nothing) when `allowRestart` is false. */
  onRestart?(): void;
  /** False for hosted tests, where the attempt cannot be thrown away and redone. */
  allowRestart?: boolean;
}

interface Live {
  /** Whole seconds left, as displayed. */
  seconds: number;
  /** Words finished so far. */
  words: number;
  started: boolean;
}

/** "45" under a minute, "1:30" from a minute up. */
function formatSeconds(s: number) {
  return s < 60 ? String(s) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Rendered once per passage. Per-key updates edit span classes directly. */
const Passage = memo(function Passage({
  chars,
  spanRefs,
}: {
  chars: string[];
  spanRefs: { current: HTMLSpanElement[] };
}) {
  return (
    <>
      {chars.map((c, i) => (
        <span
          key={i}
          ref={(el) => {
            if (el) spanRefs.current[i] = el;
          }}
          className="ch"
        >
          {c}
        </span>
      ))}
    </>
  );
});

export function TypingTest({
  text,
  durationMs,
  mode,
  layout,
  onFinish,
  onStart,
  onRestart,
  allowRestart = true,
}: TypingTestProps) {
  const chars = useMemo(() => Array.from(text), [text]);
  // spacesBefore[i] = words finished once i characters are typed.
  const spacesBefore = useMemo(() => {
    const a = new Int32Array(chars.length + 1);
    for (let i = 0; i < chars.length; i++) a[i + 1] = a[i]! + (chars[i] === " " ? 1 : 0);
    return a;
  }, [chars]);
  const totalWords = spacesBefore[chars.length]! + 1;
  const spanRefs = useRef<HTMLSpanElement[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const [live, setLive] = useState<Live>({
    seconds: Math.ceil(durationMs / 1000),
    words: 0,
    started: false,
  });

  // Keep the latest callbacks without re-creating the session.
  const callbacks = useRef({ onFinish, onStart });
  callbacks.current = { onFinish, onStart };

  useEffect(() => {
    const session = new TypingSession(text, durationMs);
    const spans = spanRefs.current;
    const box = boxRef.current!;
    const caret = caretRef.current!;
    let painted = 0;
    let done = false;
    let started = false;
    let endActivity: (() => void) | undefined;

    // Where each character sits, measured once. Typing only changes colours,
    // so these stay valid and moving the caret never needs a layout pass.
    // Re-measured when the box resizes or the fonts finish loading.
    const lefts = new Float64Array(spans.length);
    const tops = new Float64Array(spans.length);
    let lineTop = -1;

    const measure = () => {
      for (let i = 0; i < spans.length; i++) {
        lefts[i] = spans[i]!.offsetLeft;
        tops[i] = spans[i]!.offsetTop;
      }
      caret.style.height = `${spans[0]?.offsetHeight ?? 0}px`;
      lineTop = -1;
      moveCaret();
    };

    const moveCaret = () => {
      const i = Math.min(session.typedLength, spans.length - 1);
      caret.style.transform = `translate(${lefts[i]! - 1}px, ${tops[i]!}px)`;
      // Only scroll when the caret starts a new line.
      if (tops[i] !== lineTop) {
        lineTop = tops[i]!;
        box.scrollTop = Math.max(0, lineTop - box.clientHeight / 3);
      }
    };

    // The work per key is a few class edits and one transform, so it runs
    // straight in the key handler: no frame of waiting before the caret moves.
    const paint = () => {
      const len = session.typedLength;
      const from = Math.max(0, Math.min(painted, len) - 1);
      const to = Math.max(painted, len);
      for (let i = from; i <= to && i < spans.length; i++) {
        const ok = session.isCorrectAt(i);
        spans[i]!.className =
          ok === undefined
            ? "ch"
            : ok
              ? "ch ok"
              : session.isSkippedAt(i)
                ? "ch miss"
                : "ch bad";
      }
      painted = len;
      moveCaret();
      const words = spacesBefore[len]!;
      setLive((prev) => (prev.words === words ? prev : { ...prev, words }));
    };

    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(box);
    let disposed = false;
    // Guarded: a test that has already been replaced must not move the caret.
    void document.fonts?.ready.then(() => !disposed && measure());

    const finish = () => {
      if (done) return;
      done = true;
      paint();
      callbacks.current.onFinish(session.result(), session.log);
      endActivity?.(); // after the result is handed over, so a login renewal never lands mid-finish
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Keys typed into a form field (e.g. a custom duration) are not test input.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      // Tab highlights the restart button; Enter then restarts (Monkeytype's
      // "tab > enter"). Pressing Tab again lets go of it.
      const restart = restartRef.current;
      if (e.key === "Tab") {
        e.preventDefault();
        if (!allowRestart) return;
        if (document.activeElement === restart) restart?.blur();
        else restart?.focus();
        return;
      }
      if (e.repeat || done) return;
      const now = performance.now(); // timestamp before any other work
      const action = layout.resolve(e);
      if (!action) return;
      e.preventDefault();
      // Typing carries on, so drop the highlight: a stray Enter must not restart.
      if (document.activeElement === restart) restart?.blur();
      if (action.type === "backspace") session.backspace(now);
      else session.input(action.char, now);
      paint();
      if (!started && session.status !== "idle") {
        started = true;
        endActivity = testActivity.start();
        callbacks.current.onStart();
      }
      if (session.status === "finished") finish();
    };

    const timer = window.setInterval(() => {
      const now = performance.now();
      session.tick(now);
      if (session.status === "finished") {
        finish();
        return;
      }
      const started = session.status === "running";
      const left = started ? durationMs - session.result(now).elapsedMs : durationMs;
      const seconds = Math.ceil(Math.max(0, left) / 1000);
      // Re-render only when the displayed second changes.
      setLive((prev) =>
        prev.seconds === seconds && prev.started === started
          ? prev
          : { ...prev, seconds, started },
      );
    }, 100);

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearInterval(timer);
      resizeObserver.disconnect();
      endActivity?.();
      disposed = true;
    };
  }, [text, durationMs, layout, spacesBefore, allowRestart]);

  return (
    <div className="test">
      <div className="timer" aria-live="off">
        {mode === "time" ? formatSeconds(live.seconds) : `${live.words}/${totalWords}`}
      </div>

      <div
        ref={boxRef}
        className={
          "passage" +
          (layout.language === "hi" ? " hindi" : "") +
          (live.started ? "" : " idle")
        }
        lang={layout.language}
      >
        <div ref={caretRef} className="caret" />
        <Passage chars={chars} spanRefs={spanRefs} />
      </div>

      {allowRestart && (
        <div className="restart-row">
          <button
            ref={restartRef}
            className="restart"
            onClick={onRestart}
            aria-label="Restart test"
            title="Restart test (Tab, then Enter)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
