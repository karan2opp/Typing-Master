export interface Config {
  port: number;
  /** Postgres connection string. Unset means a local PGlite database in `dataDir`. */
  databaseUrl?: string;
  dataDir: string;
  jwtSecret: string;
  /** Created at start-up when no admin exists yet. */
  adminUsername?: string;
  adminPassword?: string;
  corsOrigins: string[];
  /** Weeks and months for leaderboards are counted in this time zone. */
  timeZone: string;
  /** Lowest accuracy (percent) a result needs to appear on a global leaderboard. */
  globalMinAccuracy: number;
  /** A folder of website files (landing page, web app, installer) to serve next to the API. Skipped if it does not exist. */
  siteDir?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  if (production && !env.JWT_SECRET) throw new Error("JWT_SECRET must be set in production");
  return {
    port: Number(env.PORT ?? 8787),
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: env.DATA_DIR ?? ".data/pglite",
    jwtSecret: env.JWT_SECRET ?? "dev-only-secret-change-me",
    adminUsername: env.ADMIN_USERNAME?.toLowerCase(),
    adminPassword: env.ADMIN_PASSWORD,
    corsOrigins: (env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
    timeZone: env.TIME_ZONE ?? "Asia/Kolkata",
    globalMinAccuracy: Number(env.GLOBAL_MIN_ACCURACY ?? 90),
    siteDir: env.SITE_DIR || undefined,
  };
}
