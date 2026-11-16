import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_LEVEL, type Language } from "@typing/engine";
import { HttpError, uuid, type Ctx } from "../http";
import { boardKey, clampTime, isGeneratedText, levelSchema, logSchema, recordBests, verifyLog } from "../scoring";

const resultSchema = z.object({
  /** Made by the device, so a retried upload after a dropped connection is not counted twice. */
  clientId: uuid,
  language: z.enum(["en", "hi"]),
  /** How deep into the word list the test drew from. */
  level: levelSchema.default(DEFAULT_LEVEL),
  mode: z.enum(["time", "words"]),
  /** Seconds for a time test, number of words for a words test. */
  value: z.number().int().min(1).max(3600),
  punctuation: z.boolean().default(false),
  numbers: z.boolean().default(false),
  text: z.string().min(1).max(60_000),
  log: logSchema,
  completedAt: z.coerce.date().optional(),
});

export async function resultRoutes(app: FastifyInstance, { db, config, studentOrDevice }: Ctx) {
  /**
   * Practice results from the apps, sent live or uploaded later by the offline
   * queue. The server rebuilds the score from the keystrokes. Every result is
   * kept; only verified plain-text ones can reach a global leaderboard, and the
   * keystroke log is kept just for those that set a record.
   */
  app.post(
    "/results",
    { preHandler: studentOrDevice, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = resultSchema.parse(req.body);
      const words = body.text.split(" ").length;
      if (body.mode === "words" && words !== body.value) {
        throw new HttpError(400, "invalid_result", "The text does not have the stated number of words");
      }
      if (body.mode === "time" && body.value < 5) {
        throw new HttpError(400, "invalid_result", "Time tests must be at least 5 seconds");
      }

      // A words test has no time limit, only a one hour cap.
      const durationMs = body.mode === "time" ? body.value * 1000 : 3_600_000;
      const { result, consistency, flags } = verifyLog(body.text, durationMs, body.log);

      const completedAt = clampTime(body.completedAt);
      const startedAt = new Date(completedAt.getTime() - result.elapsedMs);
      const finished = body.mode === "time" || result.elapsedMs < durationMs;
      const plain = !body.punctuation && !body.numbers;
      const verified = finished && isGeneratedText(body.text, body.language as Language, body.level);
      const board =
        boardKey(body.language, body.level, body.mode, body.value) +
        (body.punctuation ? "+punctuation" : "") +
        (body.numbers ? "+numbers" : "");

      const [attempt] = await db.query<{ id: string }>(
        `INSERT INTO attempts
           (client_id, user_id, kind, language, board, duration_ms, wpm, raw_wpm, accuracy, consistency,
            correct_chars, incorrect_chars, extra_chars, missed_chars, verified, flagged, flag_reason,
            started_at, submitted_at)
         VALUES ($1, $2, 'practice', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (client_id) DO NOTHING
         RETURNING id`,
        [
          body.clientId,
          req.actor.id,
          body.language,
          board,
          Math.round(result.elapsedMs),
          result.wpm,
          result.rawWpm,
          result.accuracy,
          consistency,
          result.correctChars,
          result.incorrectChars,
          result.extraChars,
          result.missedChars,
          verified,
          flags.length > 0,
          flags.length > 0 ? flags.join("; ") : null,
          startedAt,
          completedAt,
        ],
      );
      if (!attempt) {
        // Same clientId again: the first upload already counted.
        reply.code(200);
        return { duplicate: true, records: [] };
      }

      let records: string[] = [];
      const eligible =
        verified && plain && flags.length === 0 && result.wpm > 0 && result.accuracy >= config.globalMinAccuracy;
      if (eligible) {
        records = await recordBests(db, config.timeZone, {
          userId: req.actor.id,
          board,
          wpm: result.wpm,
          rawWpm: result.rawWpm,
          accuracy: result.accuracy,
          attemptId: attempt.id,
          at: completedAt,
        });
        // Keep the proof for results that took a record, so it can be audited later.
        if (records.length > 0) {
          await db.query("UPDATE attempts SET log = $2::jsonb WHERE id = $1", [attempt.id, JSON.stringify(body.log)]);
        }
      }

      reply.code(201);
      return {
        id: attempt.id,
        duplicate: false,
        result: { ...result, consistency },
        verified,
        flagged: flags.length > 0,
        flagReason: flags.length > 0 ? flags.join("; ") : null,
        onLeaderboard: eligible,
        records,
      };
    },
  );
}
