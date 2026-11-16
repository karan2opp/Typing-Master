import { z } from "zod";
import {
  buildTimeline,
  replayLog,
  wordsFor,
  type Language,
  type LogEntry,
  type TypingResult,
  type WordLevel,
} from "@typing/engine";
import type { Db } from "./db";

/** Faster than any human has sustainably typed; above this a result is held for review. */
export const MAX_PLAUSIBLE_WPM = 300;

const nondecreasing = (log: { t: number }[]) => log.every((e, i) => i === 0 || e.t >= log[i - 1]!.t);

/** A keystroke log as the apps send it. */
export const logSchema = z
  .array(z.object({ t: z.number().min(0).max(3_700_000), c: z.string().min(1).max(8) }))
  .max(30_000)
  .refine(nondecreasing, "Keystroke times must not go backwards");

/** Easier word lists get their own boards, as a test of 200 short words is not the same test as 10,000. */
export const boardKey = (language: Language, level: WordLevel, mode: "time" | "words", value: number) =>
  `${language}:${level}:${mode}:${value}`;

/** A word level in a request: one of the supported difficulties. */
export const levelSchema = z.union([z.literal(200), z.literal(1000), z.literal(5000), z.literal(10000)]);

export interface Verified {
  result: TypingResult;
  consistency: number;
  /** Reasons to hold the result back from leaderboards until a teacher looks. */
  flags: string[];
}

/** Rebuilds the score from the keystrokes, so a client can never report a number the log doesn't support. */
export function verifyLog(text: string, durationMs: number, log: readonly LogEntry[]): Verified {
  const result = replayLog(text, durationMs, log);
  const { consistency } = buildTimeline(text, durationMs, log);
  const flags: string[] = [];

  if (result.wpm > MAX_PLAUSIBLE_WPM) flags.push(`${Math.round(result.wpm)} wpm is not humanly plausible`);

  const gaps = log.slice(1).map((e, i) => e.t - log[i]!.t);
  if (gaps.length >= 30) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
    if (sd < 4) flags.push("keystroke timing is perfectly regular");
  }
  return { result, consistency, flags };
}

const levelSets = new Map<string, Set<string>>();
function levelSet(language: Language, level: WordLevel) {
  const key = `${language}:${level}`;
  let set = levelSets.get(key);
  if (!set) levelSets.set(key, (set = new Set(wordsFor(language, level))));
  return set;
}

/**
 * True when `text` could have been produced by the app's generator at this
 * level: every word is from the level's list (or a number), no word repeats
 * within two places (the generator never does), and the words are as varied as
 * a random draw would be. Until the server hands out the texts itself this
 * stops a client claiming a leaderboard score on text it wrote to be easy,
 * such as "a a a a ..." or a short cycle of tiny words.
 */
export function isGeneratedText(text: string, language: Language, level: WordLevel): boolean {
  const known = levelSet(language, level);
  const words: string[] = [];
  for (const token of text.normalize("NFC").split(" ")) {
    const bare = token.replace(/\p{P}/gu, "").toLowerCase();
    if (/^[0-9]{1,4}$/.test(bare) || /^[०-९]{1,4}$/.test(bare)) continue;
    if (!known.has(bare)) return false;
    words.push(bare);
  }
  if (words.some((w, i) => w === words[i - 1] || w === words[i - 2])) return false;
  if (words.length >= 20) {
    // Distinct words expected from that many random picks out of the list.
    const n = known.size;
    const expected = n * (1 - Math.pow(1 - 1 / n, words.length));
    if (new Set(words).size < 0.6 * expected) return false;
  }
  return true;
}

/** Result times come from the device; keep them believable. */
export function clampTime(claimed: Date | undefined, now = new Date()): Date {
  if (!claimed) return now;
  const ms = claimed.getTime();
  const tooFuture = ms > now.getTime() + 5 * 60_000;
  const tooOld = ms < now.getTime() - 30 * 86_400_000;
  return Number.isNaN(ms) || tooFuture || tooOld ? now : claimed;
}

export type Period = "week" | "month" | "all";
export const PERIODS: readonly Period[] = ["week", "month", "all"];

/**
 * First day (YYYY-MM-DD) of the week and month containing `at`, counted in the
 * institute's time zone (weeks start on Monday). The all-time board has one
 * fixed start date.
 */
export async function periodStarts(db: Db, timeZone: string, at: Date = new Date()): Promise<Record<Period, string>> {
  const [row] = await db.query<{ week: string; month: string }>(
    `SELECT date_trunc('week',  $1::timestamptz AT TIME ZONE $2::text)::date::text AS week,
            date_trunc('month', $1::timestamptz AT TIME ZONE $2::text)::date::text AS month`,
    [at, timeZone],
  );
  return { week: row!.week, month: row!.month, all: "1970-01-01" };
}

export interface BestInput {
  userId: string;
  board: string;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  attemptId: string;
  at: Date;
}

/**
 * Stores the result as the student's best for this week, month and all time
 * wherever it beats what is there. Returns the periods it set a new record in.
 */
export async function recordBests(db: Db, timeZone: string, b: BestInput): Promise<Period[]> {
  const records: Period[] = [];
  const starts = await periodStarts(db, timeZone, b.at);
  for (const period of PERIODS) {
    const rows = await db.query(
      `INSERT INTO leaderboard_bests
         (user_id, board, period, period_start, wpm, raw_wpm, accuracy, attempt_id, achieved_at)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, board, period, period_start) DO UPDATE
         SET wpm = EXCLUDED.wpm, raw_wpm = EXCLUDED.raw_wpm, accuracy = EXCLUDED.accuracy,
             attempt_id = EXCLUDED.attempt_id, achieved_at = EXCLUDED.achieved_at
         WHERE EXCLUDED.wpm > leaderboard_bests.wpm
            OR (EXCLUDED.wpm = leaderboard_bests.wpm AND EXCLUDED.accuracy > leaderboard_bests.accuracy)
       RETURNING period`,
      [b.userId, b.board, period, starts[period], b.wpm, b.rawWpm, b.accuracy, b.attemptId, b.at],
    );
    if (rows.length > 0) records.push(period);
  }
  return records;
}
