import { computeMetrics, type TypingResult } from "./metrics";

/** Marker used in the keystroke log for a backspace. */
export const BACKSPACE = "\b";

/** Placeholder in the typed text for a letter skipped by pressing Space early. */
const SKIPPED = "\u0000";

export interface LogEntry {
  /** Milliseconds since the first keystroke. */
  t: number;
  /** The character produced, or BACKSPACE. */
  c: string;
}

export type SessionStatus = "idle" | "running" | "finished";

/**
 * One typing attempt. All per-key work is O(1): the handler only appends to
 * arrays and updates counters, so rendering can be done separately.
 *
 * The clock starts on the first keystroke, not when the test is displayed.
 */
export class TypingSession {
  private readonly expected: string[];
  private readonly typed: string[] = [];
  private correct = 0;
  private startedAt: number | null = null;
  private endedMs: number | null = null;
  private keystrokes = 0;
  private backspaces = 0;
  private mistakes = 0;
  /** SKIPPED placeholders currently in `typed`. */
  private skipped = 0;
  /** Letters typed past the end of a word. They are not added to `typed`. */
  private extra = 0;
  private readonly entries: LogEntry[] = [];

  constructor(
    text: string,
    readonly durationMs: number,
    private readonly charsPerWord?: number,
  ) {
    this.expected = Array.from(text);
  }

  get status(): SessionStatus {
    if (this.endedMs !== null) return "finished";
    return this.startedAt === null ? "idle" : "running";
  }

  get typedLength() {
    return this.typed.length;
  }

  get length() {
    return this.expected.length;
  }

  get log(): readonly LogEntry[] {
    return this.entries;
  }

  /** The character at index i of the typed text, or undefined. */
  typedAt(i: number) {
    return this.typed[i];
  }

  isCorrectAt(i: number) {
    const t = this.typed[i];
    return t === undefined ? undefined : t === this.expected[i];
  }

  /** True for a letter that was skipped by pressing Space early. */
  isSkippedAt(i: number) {
    return this.typed[i] === SKIPPED;
  }

  /**
   * Feed a resolved character (may be several code points, e.g. "र्").
   *
   * Space moves to the next word, even from the middle of one: the rest of
   * the word is marked missed. Space before the first letter of a word is
   * ignored, and letters typed past the end of a word are counted as extra
   * without moving on, so the text always stays aligned word for word.
   */
  input(char: string, now: number): boolean {
    if (char === " " && this.atWordStart()) return false;
    if (!this.begin(now)) return false;
    const t = now - this.startedAt!;
    this.keystrokes++;
    this.entries.push({ t, c: char });
    if (char === " ") this.nextWord();
    else for (const cp of Array.from(char)) this.typeLetter(cp);
    if (this.typed.length >= this.expected.length) this.endedMs = t;
    return true;
  }

  backspace(now: number): boolean {
    if (!this.begin(now)) return false;
    const t = now - this.startedAt!;
    this.keystrokes++;
    this.backspaces++;
    this.entries.push({ t, c: BACKSPACE });
    const last = this.typed.pop();
    if (last !== undefined && last === this.expected[this.typed.length]) {
      this.correct--;
    }
    // Backspacing over a Space that skipped letters returns to where the
    // word was left, instead of making the student delete each missed letter.
    if (last === " ") {
      while (this.typed[this.typed.length - 1] === SKIPPED) {
        this.typed.pop();
        this.skipped--;
      }
    }
    return true;
  }

  /** Call from a timer. Returns true once the test is over. */
  tick(now: number): boolean {
    if (this.status === "running" && now - this.startedAt! >= this.durationMs) {
      this.endedMs = this.durationMs;
    }
    return this.status === "finished";
  }

  /** End the test explicitly (e.g. the server replaying a log). */
  finish(now: number) {
    if (this.status === "running") {
      this.endedMs = Math.min(now - this.startedAt!, this.durationMs);
    }
  }

  result(now?: number): TypingResult {
    let elapsedMs = 0;
    if (this.endedMs !== null) elapsedMs = this.endedMs;
    else if (this.startedAt !== null && now !== undefined) {
      elapsedMs = Math.min(now - this.startedAt, this.durationMs);
    }
    const typedChars = this.typed.length - this.skipped + this.extra;
    return {
      typedChars,
      correctChars: this.correct,
      incorrectChars: this.typed.length - this.skipped - this.correct,
      extraChars: this.extra,
      missedChars: this.skipped,
      mistakes: this.mistakes,
      keystrokes: this.keystrokes,
      backspaces: this.backspaces,
      elapsedMs,
      ...computeMetrics({
        typedChars,
        correctChars: this.correct,
        missedChars: this.skipped,
        elapsedMs,
        charsPerWord: this.charsPerWord,
      }),
    };
  }

  /** True when the next letter to type is the first one of a word. */
  private atWordStart() {
    const n = this.typed.length;
    return n === 0 || this.expected[n - 1] === " ";
  }

  private typeLetter(cp: string) {
    const n = this.typed.length;
    if (n >= this.expected.length) return;
    if (this.expected[n] === " ") {
      this.extra++;
      this.mistakes++;
      return;
    }
    if (cp !== this.expected[n]) this.mistakes++;
    else this.correct++;
    this.typed.push(cp);
  }

  private nextWord() {
    const n = this.typed.length;
    const end = this.expected.indexOf(" ", n);
    const wordEnd = end === -1 ? this.expected.length : end;
    for (let i = n; i < wordEnd; i++) {
      this.typed.push(SKIPPED);
      this.skipped++;
      this.mistakes++;
    }
    if (this.typed.length < this.expected.length) {
      this.typed.push(" ");
      this.correct++;
    }
  }

  /** Returns false if the session cannot accept more input. */
  private begin(now: number): boolean {
    if (this.status === "finished") return false;
    if (this.startedAt === null) this.startedAt = now;
    if (now - this.startedAt >= this.durationMs) {
      this.endedMs = this.durationMs;
      return false;
    }
    return true;
  }
}

/**
 * Rebuild a result from a keystroke log. The server uses this so the score
 * it stores always comes from the log, never from client-reported numbers.
 */
export function replayLog(
  text: string,
  durationMs: number,
  log: readonly LogEntry[],
  charsPerWord?: number,
): TypingResult {
  const session = new TypingSession(text, durationMs, charsPerWord);
  for (const e of log) {
    if (e.c === BACKSPACE) session.backspace(e.t);
    else session.input(e.c, e.t);
  }
  session.finish(durationMs);
  return session.result();
}
