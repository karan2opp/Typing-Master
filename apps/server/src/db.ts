import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

/**
 * The few database operations the server needs. Two implementations: PGlite
 * (Postgres compiled to WebAssembly, no install; used for local development
 * and tests) and a real Postgres connection (used in production).
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs several statements at once (migrations). No parameters. */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  // PGlite creates the folder but not its parents, so a fresh checkout has no `.data` yet.
  if (dataDir && !dataDir.includes("://")) mkdirSync(dirname(dataDir), { recursive: true });
  const lite = await PGlite.create(dataDir);
  const wrap = (c: Pick<PGlite, "query" | "exec">, tx = false): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await c.query<T>(sql, params)).rows;
    },
    async exec(sql) {
      await c.exec(sql);
    },
    transaction: async (fn) =>
      tx ? fn(wrap(c, true)) : lite.transaction((t) => fn(wrap(t, true))),
    close: async () => {
      if (!tx) await lite.close();
    },
  });
  return wrap(lite);
}

export function createPgDb(connectionString: string): Db {
  // Hosted Postgres (Neon etc.) needs TLS; its certificates are not in the local trust store.
  const pool = new pg.Pool({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
    max: 5,
  });
  const wrap = (c: pg.Pool | pg.PoolClient, tx = false): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await c.query(sql, params)).rows as T[];
    },
    async exec(sql) {
      await c.query(sql);
    },
    transaction: async (fn) => {
      if (tx) return fn(wrap(c, true));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(wrap(client, true));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    close: async () => {
      if (!tx) await pool.end();
    },
  });
  return wrap(pool);
}
