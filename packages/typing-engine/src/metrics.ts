export const DEFAULT_CHARS_PER_WORD = 5;

export interface TypingResult {
  /** Characters actually typed (skipped letters are not typed). */
  typedChars: number;
  /** Typed characters that match the passage. */
  correctChars: number;
  /** Typed characters that are wrong. */
  incorrectChars: number;
  /** Letters typed past the end of a word; they never enter the text. */
  extraChars: number;
  /** Letters left out of a word by pressing Space early. */
  missedChars: number;
  /** incorrect + extra + missed: everything that is not correct. */
  errors: number;
  /** Every wrong keystroke made, including ones later corrected. */
  mistakes: number;
  keystrokes: number;
  backspaces: number;
  elapsedMs: number;
  /** Speed from correct characters only. Errors are not subtracted. */
  wpm: number;
  /** Speed from every character typed, right or wrong. */
  rawWpm: number;
  /** Percentage 0-100 of the final typed text that is correct. */
  accuracy: number;
}

export interface MetricsInput {
  /** Characters actually typed, including wrong and extra ones. */
  typedChars: number;
  correctChars: number;
  /** Letters skipped by pressing Space early. Not typed, but not correct. */
  missedChars?: number;
  elapsedMs: number;
  charsPerWord?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pure scoring function. The server calls this too, so a client can never
 * report a score the engine would not produce from the same typed text.
 */
export function computeMetrics({
  typedChars,
  correctChars,
  missedChars = 0,
  elapsedMs,
  charsPerWord = DEFAULT_CHARS_PER_WORD,
}: MetricsInput) {
  const minutes = elapsedMs / 60_000;
  const errors = typedChars + missedChars - correctChars;
  const rawWpm = minutes > 0 ? typedChars / charsPerWord / minutes : 0;
  // Same convention as Monkeytype: wrong characters simply don't count, and
  // there is no extra penalty on top.
  const wpm = minutes > 0 ? correctChars / charsPerWord / minutes : 0;
  // Skipping letters hurts accuracy: they are in the passage and were not typed.
  const attempted = typedChars + missedChars;
  const accuracy = attempted > 0 ? (correctChars / attempted) * 100 : 0;
  return {
    errors,
    wpm: round2(wpm),
    rawWpm: round2(rawWpm),
    accuracy: round2(accuracy),
  };
}
