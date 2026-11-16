import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_LEVEL } from "@typing/engine";
import { page, type Ctx } from "../http";
import { boardKey, levelSchema, periodStarts } from "../scoring";

const querySchema = z.object({
  language: z.enum(["en", "hi"]).default("en"),
  level: z.coerce.number().pipe(levelSchema).default(DEFAULT_LEVEL),
  mode: z.enum(["time", "words"]).default("time"),
  /** Seconds for time boards, word count for words boards. */
  value: z.coerce.number().int().min(1).max(3600).default(60),
  period: z.enum(["week", "month", "all"]).default("week"),
});

export async function leaderboardRoutes(app: FastifyInstance, { db, config, auth }: Ctx) {
  /** Each student's best for the current week, month, or all time. */
  app.get("/leaderboards", { preHandler: auth() }, async (req) => {
    const q = querySchema.parse(req.query);
    const { limit } = page(req.query, 50, 200);
    const board = boardKey(q.language, q.level, q.mode, q.value);
    const periodStart = (await periodStarts(db, config.timeZone))[q.period];

    const rows = await db.query<{ rank: number; userId: string }>(
      `WITH ranked AS (
         SELECT b.user_id AS "userId", u.display_name AS "displayName", u.username,
                b.wpm, b.raw_wpm AS "rawWpm", b.accuracy, b.achieved_at AS "achievedAt",
                rank() OVER (ORDER BY b.wpm DESC, b.accuracy DESC, b.achieved_at ASC)::int AS rank
           FROM leaderboard_bests b JOIN users u ON u.id = b.user_id
          WHERE b.board = $1 AND b.period = $2 AND b.period_start = $3::date AND NOT u.disabled
       )
       SELECT * FROM ranked WHERE rank <= $4 OR "userId" = $5 ORDER BY rank, "achievedAt"`,
      [board, q.period, periodStart, limit, req.actor.id],
    );
    return {
      board,
      period: q.period,
      periodStart,
      minAccuracy: config.globalMinAccuracy,
      entries: rows.filter((r) => r.rank <= limit),
      // The student's own row when they are outside the top list.
      me: rows.find((r) => r.userId === req.actor.id && r.rank > limit) ?? null,
    };
  });
}
