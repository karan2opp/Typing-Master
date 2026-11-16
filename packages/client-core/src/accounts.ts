import { hashPassword, verifyPassword } from "@typing/engine";
import type { KvStore } from "./store";
import type { User } from "./types";
import { checkDisplayName, checkPassword, checkUsername, normalizeUsername } from "./validation";

/**
 * - `synced`: the server knows this account.
 * - `pending`: made on this computer while offline, not uploaded yet.
 * - `conflict`: the server already has another student with this username; it needs a new one.
 */
export type AccountSync = "synced" | "pending" | "conflict";

/** A student account stored on this computer, so login works with no internet. */
export interface LocalAccount {
  /** Also the account's id on the server: an offline account keeps its id when it is uploaded. */
  id: string;
  username: string;
  displayName: string;
  /** Checked offline. The plain password is never stored. */
  passwordHash: string;
  sync: AccountSync;
  createdAt: number;
  lastLoginAt?: number;
  /**
   * Random key that lets this computer upload the student's practice results without a login.
   * Missing on accounts saved by older versions; made at the next login.
   */
  deviceKey?: string;
  /** The server has this key. Until then results need a login. */
  deviceKeyOk?: boolean;
}

const newDeviceKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export class AccountError extends Error {}

const key = (id: string) => `account:${id}`;

export class AccountBook {
  constructor(
    private readonly store: KvStore,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Most recently used first. */
  async list(): Promise<LocalAccount[]> {
    const keys = await this.store.keys("account:");
    const all = await Promise.all(keys.map((k) => this.store.get<LocalAccount>(k)));
    return all
      .filter((a): a is LocalAccount => !!a)
      .sort((a, b) => (b.lastLoginAt ?? b.createdAt) - (a.lastLoginAt ?? a.createdAt));
  }

  get = (id: string) => this.store.get<LocalAccount>(key(id));

  private async save(a: LocalAccount) {
    await this.store.set(key(a.id), a);
    return a;
  }

  /** A new account made while the server is unreachable. */
  async createOffline(input: { username: string; displayName: string; password: string }): Promise<LocalAccount> {
    const problem =
      checkUsername(input.username) ?? checkDisplayName(input.displayName) ?? checkPassword(input.password);
    if (problem) throw new AccountError(problem);
    const username = normalizeUsername(input.username);
    if ((await this.list()).some((a) => a.username === username)) {
      throw new AccountError("That username is already used on this computer");
    }
    return this.save({
      id: crypto.randomUUID(),
      username,
      displayName: input.displayName.trim(),
      passwordHash: await hashPassword(input.password),
      sync: "pending",
      createdAt: this.clock(),
      lastLoginAt: this.clock(),
      deviceKey: newDeviceKey(),
      deviceKeyOk: false,
    });
  }

  /**
   * Keep a copy of an account the server just accepted (login or sign-up), so
   * the same student can log in here later without internet.
   */
  async remember(user: Pick<User, "id" | "username" | "displayName">, password: string): Promise<LocalAccount> {
    const existing = await this.get(user.id);
    const saved = await this.save({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      passwordHash: await hashPassword(password),
      sync: "synced",
      createdAt: existing?.createdAt ?? this.clock(),
      lastLoginAt: this.clock(),
      deviceKey: existing?.deviceKey ?? newDeviceKey(),
      deviceKeyOk: existing?.deviceKeyOk ?? false,
    });
    // Another account on this computer that wanted the same name, but is not the server's one, must change.
    for (const other of await this.list()) {
      if (other.id !== user.id && other.username === user.username && other.sync !== "synced") {
        await this.save({ ...other, sync: "conflict" });
      }
    }
    return saved;
  }

  /** Offline login: the account on this computer whose password matches, or null. */
  async verify(username: string, password: string): Promise<LocalAccount | null> {
    const name = normalizeUsername(username);
    const candidates = (await this.list())
      .filter((a) => a.username === name)
      // The server's own account first if two share a name.
      .sort((a, b) => Number(b.sync === "synced") - Number(a.sync === "synced"));
    for (const account of candidates) {
      if (await verifyPassword(password, account.passwordHash)) {
        return this.save({ ...account, lastLoginAt: this.clock() });
      }
    }
    return null;
  }

  async pending() {
    return (await this.list()).filter((a) => a.sync === "pending");
  }

  async conflicts() {
    return (await this.list()).filter((a) => a.sync === "conflict");
  }

  async setSync(id: string, sync: AccountSync) {
    const a = await this.get(id);
    if (a) await this.save({ ...a, sync });
  }

  /** This computer's upload key for the account, made now if the account predates keys. */
  async ensureDeviceKey(id: string): Promise<string | undefined> {
    const a = await this.get(id);
    if (!a) return undefined;
    if (a.deviceKey) return a.deviceKey;
    const deviceKey = newDeviceKey();
    await this.save({ ...a, deviceKey, deviceKeyOk: false });
    return deviceKey;
  }

  async setDeviceKeyOk(id: string, ok: boolean) {
    const a = await this.get(id);
    if (a) await this.save({ ...a, deviceKeyOk: ok });
  }

  /** The key to upload with, only if the server is known to have it. */
  async uploadKey(id: string): Promise<string | undefined> {
    const a = await this.get(id);
    return a?.deviceKeyOk ? a.deviceKey : undefined;
  }

  /** Choose a different username for an account the server refused, and queue it for upload again. */
  async rename(id: string, newUsername: string): Promise<LocalAccount> {
    const problem = checkUsername(newUsername);
    if (problem) throw new AccountError(problem);
    const username = normalizeUsername(newUsername);
    const all = await this.list();
    const account = all.find((a) => a.id === id);
    if (!account) throw new AccountError("No such account on this computer");
    if (all.some((a) => a.id !== id && a.username === username)) {
      throw new AccountError("That username is already used on this computer");
    }
    return this.save({ ...account, username, sync: "pending" });
  }
}
