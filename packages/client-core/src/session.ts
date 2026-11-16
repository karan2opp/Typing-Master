import type { KvStore } from "./store";
import type { User } from "./types";

export interface StoredSession {
  user: User;
  /** Missing for a student who logged in offline. */
  token?: string;
  tokenExpiresAt?: number;
  /** When this login ends and the password is asked for again. */
  expiresAt?: number;
}

/** How long a login lasts, counted from signing in: one hour and five minutes. */
export const SESSION_MS = 65 * 60 * 1000;

/** When a login token stops working, read from the token itself (not verified: the server does that). */
export function tokenExpiry(token: string): number | undefined {
  try {
    const payload = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const exp = (JSON.parse(atob(payload)) as { exp?: number }).exp;
    return typeof exp === "number" ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

const KEY = "session";

/** Remembers who is logged in, so closing and reopening the app does not log them out. */
export class SessionStore {
  constructor(
    private readonly store: KvStore,
    private readonly clock: () => number = Date.now,
  ) {}

  async load(): Promise<StoredSession | null> {
    const s = await this.store.get<StoredSession>(KEY);
    if (!s) return null;
    // A login saved without an end time (older versions) counts as over.
    if (s.expiresAt === undefined || s.expiresAt <= this.clock()) return null;
    const expired = s.tokenExpiresAt !== undefined && s.tokenExpiresAt <= this.clock();
    if (!expired) return s;
    // Staff only work online, so an expired login ends their session. A student carries on offline.
    return s.user.role === "student" ? { user: s.user } : null;
  }

  /** A new login lasts SESSION_MS; pass `expiresAt` to update a login without lengthening it. */
  async save(s: { user: User; token?: string }, expiresAt: number = this.clock() + SESSION_MS) {
    const stored: StoredSession = {
      user: s.user,
      expiresAt,
      ...(s.token ? { token: s.token, tokenExpiresAt: tokenExpiry(s.token) } : {}),
    };
    await this.store.set(KEY, stored);
    return expiresAt;
  }

  clear = () => this.store.delete(KEY);
}
