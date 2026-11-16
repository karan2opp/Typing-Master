import type { Db } from "./db";

/**
 * Schema, applied in order and recorded so each runs once. Add new entries at
 * the end; never edit one that has been released.
 *
 * Numbers are `double precision` and counts are cast to int when read: the
 * Postgres driver returns bigint/numeric as strings, which would leak into the API.
 */
const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_initial",
    sql: `
      CREATE TABLE users (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username      text NOT NULL UNIQUE,
        display_name  text NOT NULL,
        password_hash text NOT NULL,
        role          text NOT NULL CHECK (role IN ('admin','teacher','student')),
        disabled      boolean NOT NULL DEFAULT false,
        created_by    uuid REFERENCES users(id),
        created_at    timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE tests (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title            text NOT NULL,
        language         text NOT NULL CHECK (language IN ('en','hi')),
        duration_seconds int  NOT NULL CHECK (duration_seconds BETWEEN 10 AND 3600),
        text             text NOT NULL,
        starts_at        timestamptz NOT NULL,
        ends_at          timestamptz NOT NULL,
        min_accuracy     int  NOT NULL DEFAULT 0 CHECK (min_accuracy BETWEEN 0 AND 100),
        max_attempts     int  NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 50),
        cancelled        boolean NOT NULL DEFAULT false,
        created_by       uuid NOT NULL REFERENCES users(id),
        created_at       timestamptz NOT NULL DEFAULT now(),
        CHECK (ends_at > starts_at)
      );

      -- One row per typing attempt. 'test' attempts belong to a hosted test and
      -- keep their keystroke log; 'practice' rows are kept small (no log).
      CREATE TABLE attempts (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id        uuid UNIQUE,
        user_id          uuid NOT NULL REFERENCES users(id),
        kind             text NOT NULL CHECK (kind IN ('test','practice')),
        test_id          uuid REFERENCES tests(id),
        language         text NOT NULL,
        board            text NOT NULL,
        duration_ms      int  NOT NULL,
        wpm              double precision NOT NULL DEFAULT 0,
        raw_wpm          double precision NOT NULL DEFAULT 0,
        accuracy         double precision NOT NULL DEFAULT 0,
        consistency      double precision NOT NULL DEFAULT 0,
        correct_chars    int NOT NULL DEFAULT 0,
        incorrect_chars  int NOT NULL DEFAULT 0,
        extra_chars      int NOT NULL DEFAULT 0,
        missed_chars     int NOT NULL DEFAULT 0,
        verified         boolean NOT NULL DEFAULT false,
        flagged          boolean NOT NULL DEFAULT false,
        flag_reason      text,
        log              jsonb,
        started_at       timestamptz NOT NULL DEFAULT now(),
        submitted_at     timestamptz
      );
      CREATE INDEX attempts_user_idx ON attempts (user_id, started_at DESC);
      CREATE INDEX attempts_test_idx ON attempts (test_id);

      -- Each student's best result per board and period (week, month, all
      -- time). Written only when a verified result beats the stored one.
      CREATE TABLE leaderboard_bests (
        user_id      uuid NOT NULL REFERENCES users(id),
        board        text NOT NULL,
        period       text NOT NULL CHECK (period IN ('week','month','all')),
        period_start date NOT NULL,
        wpm          double precision NOT NULL,
        raw_wpm      double precision NOT NULL,
        accuracy     double precision NOT NULL,
        attempt_id   uuid NOT NULL REFERENCES attempts(id),
        achieved_at  timestamptz NOT NULL,
        PRIMARY KEY (user_id, board, period, period_start)
      );
      CREATE INDEX leaderboard_rank_idx ON leaderboard_bests (board, period, period_start, wpm DESC);
    `,
  },
  {
    id: "002_device_keys",
    sql: `
      -- A random key each student's computer keeps, so offline work uploads without asking for the
      -- password again. It can only submit practice results for that student; it cannot log in or read
      -- anything. Only a hash is stored.
      CREATE TABLE device_keys (
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key_hash   text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, key_hash)
      );
    `,
  },
];

export async function migrate(db: Db) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const done = new Set((await db.query<{ id: string }>("SELECT id FROM schema_migrations")).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
    });
  }
}
