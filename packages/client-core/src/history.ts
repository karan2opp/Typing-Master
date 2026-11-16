import type { KvStore } from "./store";

/** One finished practice test, kept on this computer so the results screen can list earlier ones. */
export interface HistoryEntry {
  id: string;
  at: number;
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
  /** e.g. "time 60 · english 1k". */
  label: string;
}

const KEEP = 100;
const pad = (n: number) => String(n).padStart(15, "0");

/** Per-student record of recent practice tests. Works offline; the server keeps the official history. */
export class PracticeHistory {
  constructor(private readonly store: KvStore) {}

  private prefix = (userId: string) => `history:${userId}:`;

  async add(userId: string, entry: HistoryEntry): Promise<void> {
    await this.store.set(`${this.prefix(userId)}${pad(entry.at)}:${entry.id}`, entry);
    const keys = await this.store.keys(this.prefix(userId));
    for (const key of keys.slice(0, Math.max(0, keys.length - KEEP))) await this.store.delete(key);
  }

  /** Newest first. */
  async list(userId: string): Promise<HistoryEntry[]> {
    const keys = (await this.store.keys(this.prefix(userId))).reverse();
    const entries = await Promise.all(keys.map((k) => this.store.get<HistoryEntry>(k)));
    return entries.filter((e): e is HistoryEntry => e !== undefined);
  }
}
