import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config";
import type { Db } from "./db";
import { studentForDeviceKey } from "./deviceKeys";
import { HttpError, type Ctx, type Role } from "./http";
import { authRoutes } from "./routes/auth";
import { leaderboardRoutes } from "./routes/leaderboards";
import { resultRoutes } from "./routes/results";
import { testRoutes } from "./routes/tests";
import { userRoutes } from "./routes/users";

export async function buildApp(deps: { db: Db; config: Config; logger?: boolean }) {
  const { db, config } = deps;
  // Behind Render's proxy, trust the forwarded client address (used by rate limits).
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true, bodyLimit: 2_000_000 });

  await app.register(cors, {
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: "70m" } });
  // Runs in preHandler, not the default onRequest, so the request body is already
  // parsed: the login throttle is keyed by the username in the body.
  await app.register(rateLimit, { global: false, hook: "preHandler" });
  app.decorateRequest("actor", undefined as never);

  // The website (landing page, browser app, installer) comes from the same address as the API, so the
  // browser app needs no server setting. Only when a built site folder exists.
  const siteRoot = config.siteDir ? resolve(config.siteDir) : undefined;
  if (siteRoot && existsSync(siteRoot)) await app.register(fastifyStatic, { root: siteRoot });

  app.setErrorHandler((err: FastifyError | HttpError | ZodError, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "Some fields are invalid",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message });
    const status = "statusCode" in err && err.statusCode ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({
      error: status === 429 ? "too_many_requests" : status >= 500 ? "server_error" : "bad_request",
      message: status >= 500 ? "Something went wrong" : err.message,
    });
  });

  const auth =
    (...roles: Role[]) =>
    async (req: FastifyRequest, _reply: FastifyReply) => {
      try {
        await req.jwtVerify();
      } catch {
        throw new HttpError(401, "unauthorized", "Please log in");
      }
      // Checked on every request so disabling an account takes effect immediately.
      const [user] = await db.query<{ id: string; role: Role; disabled: boolean }>(
        "SELECT id, role, disabled FROM users WHERE id = $1",
        [req.user.sub],
      );
      if (!user || user.disabled) throw new HttpError(401, "unauthorized", "Please log in");
      if (roles.length > 0 && !roles.includes(user.role)) {
        throw new HttpError(403, "forbidden", "You do not have access to this");
      }
      req.actor = { id: user.id, role: user.role };
    };

  const studentOrDevice = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers["x-device-key"];
    if (typeof header !== "string") return auth("student")(req, reply);
    const id = await studentForDeviceKey(db, header);
    if (!id) throw new HttpError(401, "unauthorized", "This computer is not signed in for uploads");
    req.actor = { id, role: "student" };
  };

  const ctx: Ctx = { db, config, auth, studentOrDevice };

  // Cheap on purpose: an uptime pinger calls this to keep the free host awake.
  app.get("/health", async () => ({ ok: true }));
  app.get("/health/db", async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });

  await app.register(async (api) => {
    await authRoutes(api, ctx);
    await userRoutes(api, ctx);
    await testRoutes(api, ctx);
    await resultRoutes(api, ctx);
    await leaderboardRoutes(api, ctx);
  });

  return app;
}
