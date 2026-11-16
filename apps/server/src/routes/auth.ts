import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, isPasswordHash, verifyPassword } from "@typing/engine";
import { deviceKeySchema, registerDeviceKey } from "../deviceKeys";
import {
  HttpError,
  USER_COLUMNS,
  displayName,
  password,
  publicUser,
  username,
  uuid,
  type Ctx,
  type UserRow,
} from "../http";

/** Compared against when a username does not exist, so timing doesn't reveal which names exist. */
let dummyHash: Promise<string> | undefined;

export async function authRoutes(app: FastifyInstance, { db, auth }: Ctx) {
  const tokenFor = (u: Pick<UserRow, "id" | "role">) => app.jwt.sign({ sub: u.id, role: u.role });

  app.post(
    "/auth/register",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z.object({ username, password, displayName }).parse(req.body);
      const hash = await hashPassword(body.password);
      const [user] = await db.query<UserRow>(
        `INSERT INTO users (username, display_name, password_hash, role)
         VALUES ($1, $2, $3, 'student')
         ON CONFLICT DO NOTHING
         RETURNING ${USER_COLUMNS}`,
        [body.username, body.displayName, hash],
      );
      if (!user) throw new HttpError(409, "username_taken", "That username is already taken");
      reply.code(201);
      return { token: tokenFor(user), user: publicUser(user) };
    },
  );

  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          // Per username as well as per address: a whole class shares one IP.
          keyGenerator: (req) =>
            `${req.ip}:${String((req.body as { username?: unknown } | undefined)?.username ?? "").toLowerCase()}`,
        },
      },
    },
    async (req) => {
      const body = z.object({ username, password: z.string().min(1).max(128) }).parse(req.body);
      const [row] = await db.query<UserRow & { password_hash: string }>(
        `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE username = $1`,
        [body.username],
      );
      dummyHash ??= hashPassword("not-a-real-password");
      const ok = await verifyPassword(body.password, row?.password_hash ?? (await dummyHash));
      if (!row || !ok) throw new HttpError(401, "bad_credentials", "Wrong username or password");
      if (row.disabled) throw new HttpError(403, "account_disabled", "This account is disabled");
      return { token: tokenFor(row), user: publicUser(row) };
    },
  );

  app.get("/auth/me", { preHandler: auth() }, async (req) => {
    const [user] = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.actor.id]);
    return { user: publicUser(user!) };
  });

  /** A new login token for someone who is logged in (the app asks for one when a test runs past the end of a login). */
  app.post("/auth/refresh", { preHandler: auth() }, async (req) => {
    const [user] = await db.query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.actor.id]);
    if (!user || user.disabled) throw new HttpError(403, "account_disabled", "This account is disabled");
    return { token: tokenFor(user), user: publicUser(user) };
  });

  app.post("/auth/change-password", { preHandler: auth() }, async (req) => {
    const body = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).parse(req.body);
    const [row] = await db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [
      req.actor.id,
    ]);
    if (!(await verifyPassword(body.currentPassword, row!.password_hash))) {
      throw new HttpError(403, "bad_credentials", "Current password is wrong");
    }
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
      await hashPassword(body.newPassword),
      req.actor.id,
    ]);
    return { ok: true };
  });

  /** A student's computer registers the key it will use to upload results later without a login. */
  app.post("/auth/device-key", { preHandler: auth("student") }, async (req) => {
    const { key } = z.object({ key: deviceKeySchema }).parse(req.body);
    await registerDeviceKey(db, req.actor.id, key);
    return { ok: true };
  });

  /**
   * Accounts a student created on a device while it was offline. The device
   * picked the id and hashed the password; the server only checks the shape.
   * Always creates a student, never a teacher or admin.
   */
  app.post(
    "/sync/accounts",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req) => {
      const { accounts } = z
        .object({
          accounts: z
            .array(
              z.object({
                id: uuid,
                username,
                displayName,
                passwordHash: z.string().refine(isPasswordHash, "Not a valid password hash"),
                /** The computer's upload key; kept only if this upload proves it holds the account. */
                deviceKey: deviceKeySchema.optional(),
              }),
            )
            .min(1)
            .max(50),
        })
        .parse(req.body);

      const results: { id: string; status: "created" | "exists" | "username_taken"; deviceKey: boolean }[] = [];
      for (const a of accounts) {
        const inserted = await db.query(
          `INSERT INTO users (id, username, display_name, password_hash, role)
           VALUES ($1, $2, $3, $4, 'student')
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [a.id, a.username, a.displayName, a.passwordHash],
        );
        if (inserted.length > 0) {
          if (a.deviceKey) await registerDeviceKey(db, a.id, a.deviceKey);
          results.push({ id: a.id, status: "created", deviceKey: !!a.deviceKey });
          continue;
        }
        // Either this exact account was already uploaded, or the name belongs to someone else. A retry after
        // a lost answer carries the same password hash the server stored: only then is the key accepted.
        const same = await db.query<{ password_hash: string }>(
          "SELECT password_hash FROM users WHERE id = $1 AND username = $2 AND role = 'student'",
          [a.id, a.username],
        );
        const mine = same.length > 0 && same[0]!.password_hash === a.passwordHash;
        if (mine && a.deviceKey) await registerDeviceKey(db, a.id, a.deviceKey);
        results.push({
          id: a.id,
          status: same.length > 0 ? "exists" : "username_taken",
          deviceKey: mine && !!a.deviceKey,
        });
      }
      return { results };
    },
  );
}
