import { ApiError, type Credential } from "./api";
import type { KvStore } from "./store";
import type { ResultBody, ResultResponse } from "./types";

/** A finished practice test waiting to be uploaded. */
export interface QueuedResult {
  /** The result's `clientId`. */
  id: string;
  userId: string;
  body: ResultBody;
  createdAt: number;
  attempts: number;
  nextTryAt: number;
  lastError?: string;
}

/** A result the server refused for good (it would never accept a retry). Kept so it is not silently lost. */
export interface RejectedResult {
  id: string;
  userId: string;
  createdAt: number;
  reason: string;
}

export interface FlushReport {
  sent: number;
  rejected: number;
  remaining: number;
  /** Why the run ended early, if it did. */
  stopped?: "unreachable" | "auth" | "backoff";
}

type Sender = { postResult(credential: Credential, body: ResultBody): Promise<ResultResponse> };

const pad = (n: number) => String(n).padStart(15, "0");
const queueKey = (r: Pick<QueuedResult, "userId" | "createdAt" | "id">) => `result:${r.userId}:${pad(r.createdAt)}:${r.id}`;

/** 5s, 10s, 20s ... up to 10 minutes between tries. */
export const retryDelayMs = (attempts: number) => Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 600_000);

/**
 * Results wait here, per student, until they can be uploaded. Uploading needs
 * that student's login token, so a student who made results offline uploads
 * them the next time they log in with a connection. Safe to retry: the
 * server ignores a `clientId` it has already seen.
 */
export class ResultQueue {
  constructor(
    private readonly store: KvStore,
    private readonly clock: () => number = Date.now,
  ) {}

  async enqueue(userId: string, body: ResultBody): Promise<QueuedResult> {
    const item: QueuedResult = { id: body.clientId, userId, body, createdAt: this.clock(), attempts: 0, nextTryAt: 0 };
    await this.store.set(queueKey(item), item);
    return item;
  }

  private keys = (userId: string) => this.store.keys(`result:${userId}:`);

  async count(userId: string) {
    return (await this.keys(userId)).length;
  }

  async list(userId: string): Promise<QueuedResult[]> {
    const items = await Promise.all((await this.keys(userId)).map((k) => this.store.get<QueuedResult>(k)));
    return items.filter((i): i is QueuedResult => !!i);
  }

  async rejected(userId: string): Promise<RejectedResult[]> {
    const items = await Promise.all(
      (await this.store.keys(`rejected:${userId}:`)).map((k) => this.store.get<RejectedResult>(k)),
    );
    return items.filter((i): i is RejectedResult => !!i);
  }

  async clearRejected(userId: string) {
    for (const k of await this.store.keys(`rejected:${userId}:`)) await this.store.delete(k);
  }

  /** Oldest first. Stops at the first sign the server is unreachable or the login no longer works. */
  async flush(
    api: Sender,
    userId: string,
    credential: Credential,
    { ignoreBackoff = false }: { ignoreBackoff?: boolean } = {},
  ): Promise<FlushReport> {
    const report: FlushReport = { sent: 0, rejected: 0, remaining: 0 };
    for (const key of await this.keys(userId)) {
      const item = await this.store.get<QueuedResult>(key);
      if (!item) continue;
      if (!ignoreBackoff && item.nextTryAt > this.clock()) {
        report.stopped = "backoff";
        break;
      }
      try {
        await api.postResult(credential, item.body);
        await this.store.delete(key);
        report.sent++;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          report.stopped = "auth";
          break;
        }
        if (e instanceof ApiError && !e.transient) {
          // The server understood and refused (invalid result): retrying cannot help.
          await this.store.delete(key);
          await this.store.set(`rejected:${userId}:${pad(item.createdAt)}:${item.id}`, {
            id: item.id,
            userId,
            createdAt: item.createdAt,
            reason: e.message,
          } satisfies RejectedResult);
          report.rejected++;
          continue;
        }
        // Unreachable, or the server is struggling: wait longer each time, and keep the result.
        const attempts = item.attempts + 1;
        await this.store.set(key, {
          ...item,
          attempts,
          nextTryAt: this.clock() + retryDelayMs(attempts),
          lastError: e instanceof Error ? e.message : String(e),
        } satisfies QueuedResult);
        report.stopped = "unreachable";
        break;
      }
    }
    report.remaining = await this.count(userId);
    return report;
  }

  /** Try again right away on the next flush (for example after logging in). */
  async resetBackoff(userId: string) {
    for (const key of await this.keys(userId)) {
      const item = await this.store.get<QueuedResult>(key);
      if (item && item.nextTryAt > 0) await this.store.set(key, { ...item, nextTryAt: 0 });
    }
  }
}
