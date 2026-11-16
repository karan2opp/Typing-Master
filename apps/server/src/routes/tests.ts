import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_LEVEL, buildText, charsForDuration, hindiInscript, type Language } from "@typing/engine";
import type { Db } from "../db";
import { HttpError, page, uuid, type Ctx } from "../http";
import { levelSchema, logSchema, verifyLog } from "../scoring";

/** Time a student may take between pressing Start and their first key, on top of the test length. */
const START_GRACE_MS = 90_000;
/** Allowance for a slow network at the end of the test. */
const SUBMIT_GRACE_MS = 15_000;

const STATUS_SQL = `CASE WHEN t.cancelled THEN 'cancelled'
                         WHEN now() < t.starts_at THEN 'upcoming'
                         WHEN now() > t.ends_at THEN 'ended'
                         ELSE 'active' END`;

const TEST_COLUMNS = `t.id, t.title, t.language, t.duration_seconds AS "durationSeconds",
  t.starts_at AS "startsAt", t.ends_at AS "endsAt", t.min_accuracy AS "minAccuracy",
  t.max_attempts AS "maxAttempts", t.cancelled, ${STATUS_SQL} AS status,
  t.created_by AS "createdBy", t.created_at AS "createdAt",
  (SELECT count(DISTINCT a.user_id)::int FROM attempts a
    WHERE a.test_id = t.id AND a.submitted_at IS NOT NULL) AS participants`;

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    language: z.enum(["en", "hi"]),
    durationSeconds: z.number().int().min(10).max(3600),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    /** Leave out to have a fresh random passage generated. */
    text: z.string().max(20_000).optional(),
    /** Word list depth for a generated passage. */
    level: levelSchema.default(DEFAULT_LEVEL),
    punctuation: z.boolean().default(false),
    numbers: z.boolean().default(false),
    minAccuracy: z.number().int().min(0).max(100).default(0),
    maxAttempts: z.number().int().min(1).max(50).default(1),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: "The test must end after it starts", path: ["endsAt"] });

/** A teacher's own passage must be something the student's keyboard layout can type. */
function cleanTeacherText(raw: string, language: Language): string {
  const text = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (text.length < 20) throw new HttpError(400, "invalid_text", "The passage is too short (at least 20 characters)");
  const bad =
    language === "en"
      ? [...new Set(Array.from(text).filter((c) => !/^[\x20-\x7E]$/.test(c)))]
      : [...new Set(Array.from(text).filter((c) => !hindiInscript.producible!.has(c)))];
  if (bad.length > 0) {
    throw new HttpError(
      400,
      "invalid_text",
      `These characters cannot be typed on the ${language === "en" ? "English" : "Hindi Inscript"} keyboard: ${bad.join(" ")}`,
    );
  }
  return text;
}

interface BoardRow {
  rank: number;
  userId: string;
  displayName: string;
  username: string;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  achievedAt: Date;
}

/** Best verified, unflagged attempt per student, ranked by speed, then accuracy, then who got there first. */
async function testLeaderboard(db: Db, testId: string, limit: number, me: string) {
  const rows = await db.query<BoardRow>(
    `WITH best AS (
       SELECT DISTINCT ON (a.user_id) a.user_id, a.wpm, a.raw_wpm, a.accuracy, a.submitted_at
         FROM attempts a JOIN tests t ON t.id = a.test_id
        WHERE a.test_id = $1 AND a.verified AND NOT a.flagged
          AND a.submitted_at IS NOT NULL AND a.accuracy >= t.min_accuracy
        ORDER BY a.user_id, a.wpm DESC, a.accuracy DESC, a.submitted_at ASC
     ), ranked AS (
       SELECT b.user_id AS "userId", u.display_name AS "displayName", u.username,
              b.wpm, b.raw_wpm AS "rawWpm", b.accuracy, b.submitted_at AS "achievedAt",
              rank() OVER (ORDER BY b.wpm DESC, b.accuracy DESC, b.submitted_at ASC)::int AS rank
         FROM best b JOIN users u ON u.id = b.user_id
     )
     SELECT * FROM ranked WHERE rank <= $2 OR "userId" = $3 ORDER BY rank, "achievedAt"`,
    [testId, limit, me],
  );
  return {
    entries: rows.filter((r) => r.rank <= limit),
    me: rows.find((r) => r.userId === me && r.rank > limit) ?? null,
    myRank: rows.find((r) => r.userId === me)?.rank ?? null,
  };
}

export async function testRoutes(app: FastifyInstance, { db, auth }: Ctx) {
  app.post("/tests", { preHandler: auth("admin", "teacher") }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const text = body.text
      ? cleanTeacherText(body.text, body.language)
      : buildText(body.language, charsForDuration(body.durationSeconds * 1000), {
          level: body.level,
          punctuation: body.punctuation,
          numbers: body.numbers,
        });
    const [created] = await db.query<{ id: string }>(
      `INSERT INTO tests (title, language, duration_seconds, text, starts_at, ends_at, min_accuracy, max_attempts, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        body.title,
        body.language,
        body.durationSeconds,
        text,
        body.startsAt,
        body.endsAt,
        body.minAccuracy,
        body.maxAttempts,
        req.actor.id,
      ],
    );
    const [test] = await db.query(`SELECT ${TEST_COLUMNS}, t.text FROM tests t WHERE t.id = $1`, [created!.id]);
    reply.code(201);
    return { test };
  });

  app.get("/tests", { preHandler: auth() }, async (req) => {
    const staff = req.actor.role !== "student";
    const { limit, offset } = page(req.query, 50, 200);
    const { status } = z
      .object({ status: z.enum(["upcoming", "active", "ended", "cancelled"]).optional() })
      .parse(req.query);
    const tests = await db.query(
      `SELECT * FROM (
         SELECT ${TEST_COLUMNS}${staff ? ", t.text" : ""},
                (SELECT count(*)::int FROM attempts a WHERE a.test_id = t.id AND a.user_id = $1) AS "myAttempts",
                (SELECT max(a.wpm) FROM attempts a
                  WHERE a.test_id = t.id AND a.user_id = $1 AND a.verified AND NOT a.flagged) AS "myBestWpm"
           FROM tests t WHERE ($2 OR NOT t.cancelled)
       ) x WHERE ($3::text IS NULL OR x.status = $3)
       ORDER BY "startsAt" DESC LIMIT $4 OFFSET $5`,
      [req.actor.id, staff, status ?? null, limit, offset],
    );
    return { tests };
  });

  app.get("/tests/:id", { preHandler: auth() }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const staff = req.actor.role !== "student";
    const [test] = await db.query(
      `SELECT ${TEST_COLUMNS}${staff ? ", t.text" : ""} FROM tests t WHERE t.id = $1 AND ($2 OR NOT t.cancelled)`,
      [id, staff],
    );
    if (!test) throw new HttpError(404, "not_found", "No such test");
    return { test };
  });

  // The passage and time cannot change once students may have seen them.
  app.patch("/tests/:id", { preHandler: auth("admin", "teacher") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({
        title: z.string().trim().min(1).max(100).optional(),
        startsAt: z.coerce.date().optional(),
        endsAt: z.coerce.date().optional(),
        cancelled: z.boolean().optional(),
      })
      .parse(req.body);
    const [current] = await db.query<{ starts_at: Date; ends_at: Date }>(
      "SELECT starts_at, ends_at FROM tests WHERE id = $1",
      [id],
    );
    if (!current) throw new HttpError(404, "not_found", "No such test");
    const startsAt = body.startsAt ?? current.starts_at;
    const endsAt = body.endsAt ?? current.ends_at;
    if (endsAt <= startsAt) throw new HttpError(400, "invalid_window", "The test must end after it starts");
    await db.query(
      `UPDATE tests SET title = COALESCE($2, title), starts_at = $3, ends_at = $4,
                        cancelled = COALESCE($5, cancelled) WHERE id = $1`,
      [id, body.title ?? null, startsAt, endsAt, body.cancelled ?? null],
    );
    const [test] = await db.query(`SELECT ${TEST_COLUMNS}, t.text FROM tests t WHERE t.id = $1`, [id]);
    return { test };
  });

  // ---- Taking a test ------------------------------------------------------

  app.post("/tests/:id/attempts", { preHandler: auth("student") }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const out = await db.transaction(async (tx) => {
      // One start at a time per student and test, so two quick clicks cannot both pass the attempts check.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${req.actor.id}:${id}`]);
      const [t] = await tx.query<{
        text: string;
        language: Language;
        duration_seconds: number;
        max_attempts: number;
        status: string;
      }>(
        `SELECT t.text, t.language, t.duration_seconds, t.max_attempts, ${STATUS_SQL} AS status
           FROM tests t WHERE t.id = $1`,
        [id],
      );
      if (!t || t.status === "cancelled") throw new HttpError(404, "not_found", "No such test");
      if (t.status === "upcoming") throw new HttpError(409, "not_started", "This test has not started yet");
      if (t.status === "ended") throw new HttpError(409, "ended", "This test has ended");

      // A start that has not been submitted and is still inside its time is resumed, not counted twice.
      const lifetimeSeconds = t.duration_seconds + (START_GRACE_MS + SUBMIT_GRACE_MS) / 1000;
      const [open] = await tx.query<{ id: string; started_at: Date }>(
        `SELECT id, started_at FROM attempts
          WHERE test_id = $1 AND user_id = $2 AND submitted_at IS NULL
            AND now() < started_at + make_interval(secs => $3)
          ORDER BY started_at DESC LIMIT 1`,
        [id, req.actor.id, lifetimeSeconds],
      );
      let attempt = open;
      if (!attempt) {
        const [count] = await tx.query<{ used: number }>(
          "SELECT count(*)::int AS used FROM attempts WHERE test_id = $1 AND user_id = $2",
          [id, req.actor.id],
        );
        if (count!.used >= t.max_attempts) {
          throw new HttpError(409, "no_attempts_left", `You have used all ${t.max_attempts} attempt(s) for this test`);
        }
        [attempt] = await tx.query<{ id: string; started_at: Date }>(
          `INSERT INTO attempts (user_id, kind, test_id, language, board, duration_ms)
           VALUES ($1, 'test', $2, $3, $4, $5) RETURNING id, started_at`,
          [req.actor.id, id, t.language, `test:${id}`, t.duration_seconds * 1000],
        );
      }
      return {
        attemptId: attempt!.id,
        text: t.text,
        durationMs: t.duration_seconds * 1000,
        startedAt: attempt!.started_at,
        serverNow: new Date(),
      };
    });
    reply.code(201);
    return out;
  });

  app.post("/attempts/:id/submit", { preHandler: auth("student") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { log } = z.object({ log: logSchema }).parse(req.body);
    const [a] = await db.query<{
      test_id: string;
      submitted_at: Date | null;
      started_at: Date;
      text: string;
      duration_seconds: number;
      min_accuracy: number;
    }>(
      `SELECT a.test_id, a.submitted_at, a.started_at, t.text, t.duration_seconds, t.min_accuracy
         FROM attempts a JOIN tests t ON t.id = a.test_id
        WHERE a.id = $1 AND a.user_id = $2 AND a.kind = 'test'`,
      [id, req.actor.id],
    );
    if (!a) throw new HttpError(404, "not_found", "No such attempt");
    if (a.submitted_at) throw new HttpError(409, "already_submitted", "This attempt was already submitted");

    const durationMs = a.duration_seconds * 1000;
    const { result, consistency, flags } = verifyLog(a.text, durationMs, log);
    const elapsed = Date.now() - a.started_at.getTime();
    if (elapsed > durationMs + START_GRACE_MS + SUBMIT_GRACE_MS) flags.push("submitted after the allowed time");

    await db.query(
      `UPDATE attempts SET wpm = $2, raw_wpm = $3, accuracy = $4, consistency = $5,
              correct_chars = $6, incorrect_chars = $7, extra_chars = $8, missed_chars = $9,
              verified = true, flagged = $10, flag_reason = $11, log = $12::jsonb, submitted_at = now()
        WHERE id = $1`,
      [
        id,
        result.wpm,
        result.rawWpm,
        result.accuracy,
        consistency,
        result.correctChars,
        result.incorrectChars,
        result.extraChars,
        result.missedChars,
        flags.length > 0,
        flags.length > 0 ? flags.join("; ") : null,
        JSON.stringify(log),
      ],
    );
    const board = await testLeaderboard(db, a.test_id, 1, req.actor.id);
    return {
      attemptId: id,
      result: { ...result, consistency },
      flagged: flags.length > 0,
      flagReason: flags.length > 0 ? flags.join("; ") : null,
      belowMinAccuracy: result.accuracy < a.min_accuracy,
      rank: board.myRank,
    };
  });

  app.get("/tests/:id/leaderboard", { preHandler: auth() }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { limit } = page(req.query, 50, 200);
    const [test] = await db.query("SELECT 1 FROM tests WHERE id = $1", [id]);
    if (!test) throw new HttpError(404, "not_found", "No such test");
    const { entries, me } = await testLeaderboard(db, id, limit, req.actor.id);
    return { entries, me };
  });

  // ---- Reviewing results (teachers and admins) ------------------------------

  app.get("/tests/:id/attempts", { preHandler: auth("admin", "teacher") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { limit, offset } = page(req.query, 100, 500);
    const attempts = await db.query(
      `SELECT a.id, a.user_id AS "userId", u.display_name AS "displayName", u.username,
              a.wpm, a.raw_wpm AS "rawWpm", a.accuracy, a.consistency,
              a.correct_chars AS "correctChars", a.incorrect_chars AS "incorrectChars",
              a.flagged, a.flag_reason AS "flagReason",
              a.started_at AS "startedAt", a.submitted_at AS "submittedAt"
         FROM attempts a JOIN users u ON u.id = a.user_id
        WHERE a.test_id = $1 ORDER BY a.wpm DESC, a.started_at LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );
    return { attempts };
  });

  // Clearing a flag puts the result on the leaderboard; setting one takes it off.
  app.patch("/attempts/:id", { preHandler: auth("admin", "teacher") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { flagged, reason } = z
      .object({ flagged: z.boolean(), reason: z.string().trim().max(200).optional() })
      .parse(req.body);
    const rows = await db.query(
      `UPDATE attempts SET flagged = $2, flag_reason = $3 WHERE id = $1 AND submitted_at IS NOT NULL RETURNING id`,
      [id, flagged, flagged ? (reason ?? "held by a teacher") : null],
    );
    if (rows.length === 0) throw new HttpError(404, "not_found", "No such submitted attempt");
    return { ok: true };
  });
}
