import { hashPassword } from "@typing/engine";
import type { Config } from "./config";
import type { Db } from "./db";

/** Creates the first admin from ADMIN_USERNAME / ADMIN_PASSWORD when the database has none. */
export async function ensureAdmin(db: Db, config: Config) {
  const [row] = await db.query<{ admins: number }>("SELECT count(*)::int AS admins FROM users WHERE role = 'admin'");
  if (row!.admins > 0) return;
  if (!config.adminUsername || !config.adminPassword) {
    console.warn("No admin account exists. Set ADMIN_USERNAME and ADMIN_PASSWORD to create one.");
    return;
  }
  await db.query(
    `INSERT INTO users (username, display_name, password_hash, role)
     VALUES ($1, 'Administrator', $2, 'admin') ON CONFLICT DO NOTHING`,
    [config.adminUsername, await hashPassword(config.adminPassword)],
  );
  console.log(`Created admin account "${config.adminUsername}".`);
}
