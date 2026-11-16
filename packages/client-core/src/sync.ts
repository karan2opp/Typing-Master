import { ApiError, isUnreachable, type ServerApi } from "./api";
import type { AccountBook, LocalAccount } from "./accounts";
import type { FlushReport, ResultQueue } from "./queue";

export interface SyncSnapshot {
  pendingResults: number;
  rejectedResults: number;
  /** Accounts made on this computer that the server does not have yet. */
  pendingAccounts: number;
  /** Accounts the server refused because the username is taken; they need a new one. */
  conflicts: LocalAccount[];
  /** `null` until the first check. */
  online: boolean | null;
  /** The login for uploading results ran out or was refused: the student must log in again while online. */
  needsLogin: boolean;
  /** This computer can upload this student's results by itself (no login needed). */
  canUpload: boolean;
}

export interface SyncTarget {
  userId: string;
  /** Without a token (an offline login) only accounts can be uploaded, not results. */
  token?: string;
}

/**
 * Moves what was done offline up to the server: first accounts, then the
 * logged-in student's queued results. Several callers can ask at once (a
 * timer, a login, a button); they share one run.
 */
export class SyncManager {
  online: boolean | null = null;
  needsLogin = false;
  private inflight?: Promise<void>;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly deps: { api: ServerApi; accounts: AccountBook; queue: ResultQueue },
  ) {}

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  async snapshot(userId?: string): Promise<SyncSnapshot> {
    const { accounts, queue } = this.deps;
    return {
      pendingResults: userId ? await queue.count(userId) : 0,
      rejectedResults: userId ? (await queue.rejected(userId)).length : 0,
      pendingAccounts: (await accounts.pending()).length,
      conflicts: await accounts.conflicts(),
      online: this.online,
      needsLogin: this.needsLogin,
      canUpload: userId ? !!(await accounts.uploadKey(userId)) : false,
    };
  }

  /** A tiny request that also wakes the free host if it is asleep. */
  async probe(): Promise<boolean> {
    try {
      await this.deps.api.http.request("GET", "/health");
      this.online = true;
    } catch (e) {
      // An answer of any kind means the server is there.
      this.online = !isUnreachable(e) && e instanceof ApiError;
    }
    return this.online;
  }

  /** Uploads accounts created offline. Returns false if the server could not be reached. */
  async syncAccounts(): Promise<boolean> {
    const { api, accounts } = this.deps;
    const pending = await accounts.pending();
    for (let i = 0; i < pending.length; i += 50) {
      const batch = pending.slice(i, i + 50);
      try {
        const { results } = await api.syncAccounts(
          await Promise.all(
            batch.map(async (a) => ({
              id: a.id,
              username: a.username,
              displayName: a.displayName,
              passwordHash: a.passwordHash,
              deviceKey: await accounts.ensureDeviceKey(a.id),
            })),
          ),
        );
        for (const r of results) {
          await accounts.setSync(r.id, r.status === "username_taken" ? "conflict" : "synced");
          if (r.deviceKey) await accounts.setDeviceKeyOk(r.id, true);
        }
      } catch (e) {
        if (isUnreachable(e)) {
          this.online = false;
          this.notify();
          return false;
        }
        // The server refused the batch outright; leave the accounts pending rather than lose them.
      }
    }
    this.notify();
    return true;
  }

  async flushResults(target: SyncTarget, options?: { ignoreBackoff?: boolean }): Promise<FlushReport | null> {
    const { api, accounts, queue } = this.deps;
    // This computer's key first: it needs no login and never runs out.
    const deviceKey = await accounts.uploadKey(target.userId);
    if (!deviceKey && !target.token) return null;
    let report = await queue.flush(api, target.userId, deviceKey ? { userId: target.userId, deviceKey } : target.token!, options);
    if (deviceKey && report.stopped === "auth") {
      // The server no longer accepts the key (a teacher reset the password). Forget it, and use the login if there is one.
      await accounts.setDeviceKeyOk(target.userId, false);
      if (target.token) report = await queue.flush(api, target.userId, target.token, { ignoreBackoff: true });
    }
    if (report.stopped === "unreachable") this.online = false;
    else if (report.stopped === "auth") this.needsLogin = true;
    else this.needsLogin = false;
    return report;
  }

  /** Check the connection, then upload whatever is waiting. */
  run(target?: SyncTarget | null, options?: { ignoreBackoff?: boolean }): Promise<void> {
    this.inflight ??= (async () => {
      if (!(await this.probe())) return;
      await this.syncAccounts();
      if (target) await this.flushResults(target, options);
    })().finally(() => {
      this.inflight = undefined;
      this.notify();
    });
    return this.inflight;
  }
}
