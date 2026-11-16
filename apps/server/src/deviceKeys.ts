import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db";

/** 32 random bytes, hex. Made by the student's computer. */
export const deviceKeySchema = z.string().regex(/^[0-9a-f]{64}$/, "Not a valid device key");

/** Computers one student may have. The oldest keys are dropped beyond this. */
const MAX_KEYS_PER_USER = 20;

// The key is random and long, so a fast hash is enough: there is nothing to brute-force.
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export async function registerDeviceKey(db: Db, userId: string, key: string): Promise<void> {
  await db.query("INSERT INTO device_keys (user_id, key_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
    userId,
    hashKey(key),
  ]);
  await db.query(
    `DELETE FROM device_keys WHERE user_id = $1 AND key_hash NOT IN (
       SELECT key_hash FROM device_keys WHERE user_id = $1 ORDER BY created_at DESC, key_hash LIMIT ${MAX_KEYS_PER_USER}
     )`,
    [userId],
  );
}

export const revokeDeviceKeys = (db: Db, userId: string) =>
  db.query("DELETE FROM device_keys WHERE user_id = $1", [userId]);

/** The student a `x-device-key` header (`<userId>.<key>`) belongs to, if it is valid and the account is active. */
export async function studentForDeviceKey(db: Db, header: string): Promise<string | null> {
  const [userId, key] = header.split(".");
  if (!userId || !key || !z.string().uuid().safeParse(userId).success || !deviceKeySchema.safeParse(key).success) {
    return null;
  }
  const rows = await db.query<{ id: string }>(
    `SELECT u.id FROM device_keys k JOIN users u ON u.id = k.user_id
     WHERE k.user_id = $1 AND k.key_hash = $2 AND u.role = 'student' AND NOT u.disabled`,
    [userId, hashKey(key)],
  );
  return rows[0]?.id ?? null;
}
