import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createPgDb, createPgliteDb } from "./db";
import { ensureAdmin } from "./seed";
import { migrate } from "./migrate";

const config = loadConfig();
const db = config.databaseUrl ? createPgDb(config.databaseUrl) : await createPgliteDb(config.dataDir);
console.log(config.databaseUrl ? "Database: Postgres" : `Database: local PGlite at ${config.dataDir}`);

await migrate(db);
await ensureAdmin(db, config);

// The built website (see `pnpm build:site`) sits two folders above this one unless SITE_DIR says otherwise.
const app = await buildApp({ db, config: { ...config, siteDir: config.siteDir ?? "../../site" }, logger: true });
await app.listen({ port: config.port, host: "0.0.0.0" });

const stop = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
