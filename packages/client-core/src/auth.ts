import { ApiError, isUnreachable, type ServerApi } from "./api";
import { AccountError, type AccountBook, type LocalAccount } from "./accounts";
import type { ResultQueue } from "./queue";
import { tokenExpiry, type SessionStore } from "./session";
import type { SyncManager } from "./sync";
import type { User } from "./types";
import { checkDisplayName, checkPassword, checkUsername, normalizeUsername } from "./validation";

export interface Session {
  user: User;
  /** Missing for a student who logged in offline: they can practise, but nothing uploads until they log in online. */
  token?: string;
  /** When this login ends (ms since 1970); the app returns to the login screen then. */
  expiresAt?: number;
}

export type AuthErrorCode =
  | "invalid"
  | "bad_credentials"
  | "account_disabled"
  | "username_taken"
  | "offline_unknown"
  | "server";

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const userFromLocal = (a: LocalAccount): User => ({
  id: a.id,
  username: a.username,
  displayName: a.displayName,
  role: "student",
  disabled: false,
  createdAt: new Date(a.createdAt).toISOString(),
});

/** The first thing wrong with a request, in words a student can act on. */
const firstProblem = (e: ApiError) => e.issues[0]?.message ?? e.message;

/**
 * Login and sign-up that work with or without a connection.
 *
 * Students: the server is asked first; if it cannot be reached, the account
 * saved on this computer is used. Teachers and admins need the server.
 */
export class AuthService {
  /**
   * Passwords typed at an offline login, by user id. Kept in memory only (never saved) and only until
   * the server is reachable, so the app can sign in for the student and upload their work unasked.
   */
  private readonly held = new Map<string, string>();

  constructor(
    private readonly d: {
      api: ServerApi;
      accounts: AccountBook;
      sessions: SessionStore;
      queue: ResultQueue;
      sync: SyncManager;
    },
  ) {}

  async restore(): Promise<Session | null> {
    const s = await this.d.sessions.load();
    return s ? { user: s.user, token: s.token, expiresAt: s.expiresAt } : null;
  }

  async logout() {
    this.held.clear();
    await this.d.sessions.clear();
  }

  /** True while this run can still sign the student in by itself once the server is reachable. */
  canUpgrade(userId: string): boolean {
    return this.held.has(userId);
  }

  /**
   * An offline session has no token. If this run still holds the password the student typed, trade it for
   * a token now that the server can be reached. Returns the new session, or null if nothing changed.
   */
  async upgrade(session: Session): Promise<Session | null> {
    const password = this.held.get(session.user.id);
    if (session.token || !password) return null;
    // The account has to be on the server before it can log in there. The regular sync run uploads it;
    // this only looks, so it can be called often without causing requests or change notices.
    if ((await this.d.accounts.get(session.user.id))?.sync !== "synced") return null;
    // Signing in behind the scenes must not stretch the login the student already has.
    const current = await this.d.sessions.load();
    if (!current?.expiresAt) return null;
    try {
      const { token, user } = await this.d.api.login({ username: session.user.username, password });
      this.held.delete(session.user.id);
      return await this.begin({ user, token }, current.expiresAt);
    } catch (e) {
      // Refused for good (e.g. a teacher changed the password): stop trying; the student logs in again.
      if (e instanceof ApiError && !e.transient) this.held.delete(session.user.id);
      return null;
    }
  }

  /**
   * Start a login's time over (the student is taking tests, so they are still here). Gets a fresh token
   * when it can. If it cannot, the old token is kept while the server would still accept it; after that a
   * student carries on without one (their results still upload) and staff, who need one, are logged out.
   */
  async renew(session: Session): Promise<Session | null> {
    let token = session.token;
    if (token) {
      try {
        const fresh = await this.d.api.refreshToken(token);
        return await this.begin({ user: fresh.user, token: fresh.token });
      } catch {
        // Not reachable, or the token is no longer accepted: handled below.
      }
      const until = tokenExpiry(token);
      if (until !== undefined && until <= Date.now()) token = undefined;
    }
    if (!token && session.user.role !== "student") return null;
    return await this.begin({ user: session.user, token });
  }

  private async begin(login: Session, expiresAt?: number): Promise<Session> {
    const session = { ...login, expiresAt: await this.d.sessions.save(login, expiresAt) };
    if (session.user.role === "student" && session.token) {
      await this.registerDeviceKey(session.user.id, session.token);
      await this.d.queue.resetBackoff(session.user.id);
      // Upload in the background: the student should not wait for it to start typing.
      void this.d.sync.run({ userId: session.user.id, token: session.token }, { ignoreBackoff: true });
    }
    return session;
  }

  /**
   * Give the server this computer's upload key, once, while there is a login. After that results upload
   * without any login, even after the app is restarted. Failing to reach the server is fine: next login.
   */
  private async registerDeviceKey(userId: string, token: string) {
    const { accounts, api } = this.d;
    if ((await accounts.get(userId))?.deviceKeyOk) return;
    const key = await accounts.ensureDeviceKey(userId);
    if (!key) return;
    try {
      await api.registerDeviceKey(token, key);
      await accounts.setDeviceKeyOk(userId, true);
    } catch {
      // Not reachable right now, or refused: nothing is lost, the student just keeps using their login.
    }
  }

  async login(username: string, password: string): Promise<Session> {
    const name = normalizeUsername(username);
    if (!name || !password) throw new AuthError("invalid", "Enter your username and password");

    // Teach the server about accounts made offline first, so they can log in online now.
    await this.d.sync.syncAccounts();

    try {
      const { token, user } = await this.d.api.login({ username: name, password });
      if (user.role === "student") await this.d.accounts.remember(user, password);
      return await this.begin({ user, token });
    } catch (e) {
      if (!(e instanceof ApiError || isUnreachable(e))) throw e;
      if (e instanceof ApiError && e.status === 403) throw new AuthError("account_disabled", e.message);
      if (e instanceof ApiError && e.status === 429) {
        throw new AuthError("server", "Too many attempts. Wait a minute and try again.");
      }
      if (e instanceof ApiError && !e.transient && e.status !== 401) throw new AuthError("invalid", firstProblem(e));

      const unreachable = isUnreachable(e);
      const local = await this.d.accounts.verify(name, password);
      // A reachable server saying "wrong password" is final for an account it knows. Only an account the
      // server has never accepted (made offline, or in conflict) may fall back to this computer's copy.
      if (local && (unreachable || local.sync !== "synced")) {
        this.held.set(local.id, password);
        return await this.begin({ user: userFromLocal(local) });
      }
      if (unreachable) {
        throw new AuthError(
          "offline_unknown",
          "The server cannot be reached and this account is not saved on this computer. Connect to the internet and try again.",
        );
      }
      throw new AuthError("bad_credentials", "Wrong username or password");
    }
  }

  async register(input: { username: string; displayName: string; password: string }): Promise<Session> {
    const problem = checkUsername(input.username) ?? checkDisplayName(input.displayName) ?? checkPassword(input.password);
    if (problem) throw new AuthError("invalid", problem);
    const username = normalizeUsername(input.username);
    const displayName = input.displayName.trim();

    try {
      const { token, user } = await this.d.api.register({ username, displayName, password: input.password });
      await this.d.accounts.remember(user, input.password);
      return await this.begin({ user, token });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) throw new AuthError("username_taken", "That username is already taken");
      if (e instanceof ApiError && !e.transient) throw new AuthError("invalid", firstProblem(e));
      if (!isUnreachable(e)) throw e;
      // No server: keep the account on this computer and upload it when there is a connection.
      try {
        const local = await this.d.accounts.createOffline({ username, displayName, password: input.password });
        this.held.set(local.id, input.password);
        return await this.begin({ user: userFromLocal(local) });
      } catch (err) {
        if (err instanceof AccountError) throw new AuthError("username_taken", err.message);
        throw err;
      }
    }
  }

  /**
   * An account the server refused because the username was taken gets a new one.
   * Returns the account as it stands after trying to upload it again.
   */
  async renameConflict(accountId: string, newUsername: string): Promise<LocalAccount> {
    try {
      await this.d.accounts.rename(accountId, newUsername);
    } catch (e) {
      if (e instanceof AccountError) throw new AuthError("invalid", e.message);
      throw e;
    }
    await this.d.sync.syncAccounts();
    const account = (await this.d.accounts.get(accountId))!;
    if (account.sync === "conflict") throw new AuthError("username_taken", "That username is also taken. Try another.");
    const s = await this.d.sessions.load();
    if (s && s.user.id === accountId) {
      await this.d.sessions.save({ user: { ...s.user, username: account.username }, token: s.token }, s.expiresAt);
    }
    return account;
  }
}
