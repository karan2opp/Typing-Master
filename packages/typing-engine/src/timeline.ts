import { DEFAULT_CHARS_PER_WORD } from "./metrics";
import { BACKSPACE, TypingSession, replayLog, type LogEntry } from "./session";

export interface TimelinePoint {
  /** Seconds since the first keystroke, at the end of this interval. */
  second: number;
  /** Running WPM from correct characters, as on the results screen. */
  wpm: number;
  /** Running raw WPM from every character typed. */
  raw: number;
  /** Raw speed within this interval alone. */
  burst: number;
  /** Wrong keystrokes made during this interval. */
  errors: number;
}

export interface Timeline {
  points: TimelinePoint[];
  /** 0-100: how steady the per-second speed was. 100 = perfectly even. */
  consistency: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Maps a coefficient of variation onto 0-100 (same curve Monkeytype uses). */
function kogasa(cov: number) {
  return 100 * (1 - Math.tanh(cov + cov ** 3 / 3 + cov ** 5 / 5));
}

function consistencyOf(values: number[]) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return round2(kogasa(Math.sqrt(variance) / mean));
}

/**
 * Per-second breakdown of an attempt, rebuilt from its keystroke log so it
 * always agrees with the stored result.
 */
export function buildTimeline(
  text: string,
  durationMs: number,
  log: readonly LogEntry[],
  charsPerWord = DEFAULT_CHARS_PER_WORD,
): Timeline {
  const end = replayLog(text, durationMs, log, charsPerWord).elapsedMs;
  if (log.length === 0 || end <= 0) return { points: [], consistency: 0 };

  // One interval per second. A last sliver under half a second is folded into
  // the previous interval so a single late key can't fake a burst spike.
  const bounds: number[] = [];
  for (let b = 1000; b < end; b += 1000) bounds.push(b);
  if (bounds.length > 0 && end - bounds[bounds.length - 1]! < 500) bounds.pop();
  bounds.push(end);

  const session = new TypingSession(text, durationMs, charsPerWord);
  const points: TimelinePoint[] = [];
  let i = 0;
  let from = 0;
  let prevMistakes = 0;
  for (const [n, to] of bounds.entries()) {
    const last = n === bounds.length - 1;
    let keys = 0;
    while (i < log.length && (last || log[i]!.t < to)) {
      const e = log[i++]!;
      if (e.c === BACKSPACE) session.backspace(e.t);
      else {
        session.input(e.c, e.t);
        keys++;
      }
    }
    const r = session.result(to);
    points.push({
      second: round2(to / 1000),
      wpm: r.wpm,
      raw: r.rawWpm,
      burst: round2(keys / charsPerWord / ((to - from) / 60_000)),
      errors: r.mistakes - prevMistakes,
    });
    prevMistakes = r.mistakes;
    from = to;
  }

  return { points, consistency: consistencyOf(points.map((p) => p.burst)) };
}
