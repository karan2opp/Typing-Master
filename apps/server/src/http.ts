import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "./config";
import type { Db } from "./db";

export type Role = "admin" | "teacher" | "student";

export interface Actor {
  id: string;
  role: Role;
}

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: Role };
    user: { sub: string; role: Role };
  }
}

export interface Ctx {
  db: Db;
  config: Config;
  /** Pre-handler: requires a valid login, optionally one of the given roles. */
  auth: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Pre-handler: a logged-in student, or a student's computer presenting its device key. */
  studentOrDevice: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

// ---- Shared request field schemas -----------------------------------------

export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{3,30}$/, "3-30 characters: letters, numbers, dot, dash or underscore");

export const password = z.string().min(6, "At least 6 characters").max(128);

export const displayName = z.string().trim().min(1).max(60);

export const uuid = z.uuid();

// ---- Row shapes ------------------------------------------------------------

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  disabled: boolean;
  created_at: Date;
}

export const USER_COLUMNS = "id, username, display_name, role, disabled, created_at";

export const publicUser = (u: UserRow) => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  role: u.role,
  disabled: u.disabled,
  createdAt: u.created_at,
});

/** Pagination from the query string, clamped. */
export function page(query: unknown, defaultLimit = 50, maxLimit = 200) {
  const q = z
    .object({
      limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .parse(query);
  return q;
}
