import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword } from "@typing/engine";
import { revokeDeviceKeys } from "../deviceKeys";
import {
  HttpError,
  USER_COLUMNS,
  displayName,
  page,
  password,
  publicUser,
  username,
  uuid,
  type Actor,
  type Ctx,
  type UserRow,
} from "../http";

const roleSchema = z.enum(["admin", "teacher", "student"]);

export async function userRoutes(app: FastifyInstance, { db, auth }: Ctx) {
  /** Loads a user the actor is allowed to manage: admins manage everyone, teachers only students. */
  async function manageable(actor: Actor, id: string): Promise<UserRow> {
    const [user] = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    if (!user) throw new HttpError(404, "not_found", "No such user");
    if (actor.role === "teacher" && user.role !== "student") {
      throw new HttpError(403, "forbidden", "Teachers can only manage students");
    }
    return user;
  }

  app.get("/users", { preHandler: auth("admin", "teacher") }, async (req) => {
    const { limit, offset } = page(req.query);
    const q = z
      .object({ role: roleSchema.optional(), q: z.string().trim().max(60).optional() })
      .parse(req.query);
    // Teachers only ever see students.
    const role = req.actor.role === "teacher" ? "student" : q.role;
    const search = q.q ? `%${q.q.toLowerCase().replace(/[%_\\]/g, "\\$&")}%` : null;
    const where = `($1::text IS NULL OR role = $1)
                   AND ($2::text IS NULL OR username LIKE $2 OR lower(display_name) LIKE $2)`;
    const [users, [count]] = await Promise.all([
      db.query<UserRow>(
        `SELECT ${USER_COLUMNS} FROM users WHERE ${where}
         ORDER BY created_at DESC, id LIMIT $3 OFFSET $4`,
        [role ?? null, search, limit, offset],
      ),
      db.query<{ total: number }>(`SELECT count(*)::int AS total FROM users WHERE ${where}`, [role ?? null, search]),
    ]);
    return { users: users.map(publicUser), total: count!.total };
  });

  app.post("/users", { preHandler: auth("admin", "teacher") }, async (req, reply) => {
    const body = z
      .object({ username, password, displayName, role: roleSchema.default("student") })
      .parse(req.body);
    if (req.actor.role === "teacher" && body.role !== "student") {
      throw new HttpError(403, "forbidden", "Teachers can only create students");
    }
    const [user] = await db.query<UserRow>(
      `INSERT INTO users (username, display_name, password_hash, role, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING ${USER_COLUMNS}`,
      [body.username, body.displayName, await hashPassword(body.password), body.role, req.actor.id],
    );
    if (!user) throw new HttpError(409, "username_taken", "That username is already taken");
    reply.code(201);
    return { user: publicUser(user) };
  });

  app.patch("/users/:id", { preHandler: auth("admin", "teacher") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ displayName: displayName.optional(), disabled: z.boolean().optional() }).parse(req.body);
    const target = await manageable(req.actor, id);
    if (body.disabled && target.id === req.actor.id) {
      throw new HttpError(400, "cannot_disable_self", "You cannot disable your own account");
    }
    const [user] = await db.query<UserRow>(
      `UPDATE users SET display_name = COALESCE($2, display_name), disabled = COALESCE($3, disabled)
       WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, body.displayName ?? null, body.disabled ?? null],
    );
    return { user: publicUser(user!) };
  });

  // There is no email, so a forgotten password is reset by a teacher or admin.
  app.post("/users/:id/reset-password", { preHandler: auth("admin", "teacher") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { newPassword } = z.object({ newPassword: password }).parse(req.body);
    await manageable(req.actor, id);
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [await hashPassword(newPassword), id]);
    // A reset usually means the account may be in the wrong hands: computers must sign in again.
    await revokeDeviceKeys(db, id);
    return { ok: true };
  });

  // A student's own history, or any student's for teachers and admins.
  app.get("/users/:id/attempts", { preHandler: auth() }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    if (req.actor.role === "student" && req.actor.id !== id) {
      throw new HttpError(403, "forbidden", "You can only see your own results");
    }
    const { limit, offset } = page(req.query, 50, 200);
    const [attempts, bests] = await Promise.all([
      db.query(
        `SELECT a.id, a.kind, a.test_id AS "testId", t.title AS "testTitle", a.language, a.board,
                a.duration_ms AS "durationMs", a.wpm, a.raw_wpm AS "rawWpm", a.accuracy,
                a.consistency, a.verified, a.flagged, a.flag_reason AS "flagReason",
                a.submitted_at AS "submittedAt"
           FROM attempts a LEFT JOIN tests t ON t.id = a.test_id
          WHERE a.user_id = $1 AND a.submitted_at IS NOT NULL
          ORDER BY a.submitted_at DESC LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      ),
      db.query(
        `SELECT board, wpm, accuracy, achieved_at AS "achievedAt"
           FROM leaderboard_bests WHERE user_id = $1 AND period = 'all' ORDER BY board`,
        [id],
      ),
    ]);
    return { attempts, bests };
  });
}
