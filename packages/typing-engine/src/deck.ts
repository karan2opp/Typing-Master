import type { Language } from "./layouts";

export interface Paragraph {
  id: string;
  language: Language;
  text: string;
}

/**
 * Where a device remembers which paragraphs it has already shown. A thin
 * interface so the desktop app can back it with SQLite and the web app with
 * localStorage, without the dealing logic knowing about either.
 */
export interface SeenStore {
  load(): string[];
  save(ids: string[]): void;
}

/**
 * Deals paragraphs in random order, never repeating one until all have been
 * shown, then starts a new round. Runs entirely on the student's device (no
 * server, works offline). One deck per language and day-set.
 */
export class PassageDeck {
  private seen: string[];

  constructor(
    private readonly paragraphs: readonly Paragraph[],
    private readonly store: SeenStore,
    private readonly random: () => number = Math.random,
  ) {
    // Drop ids that are no longer in the set (a new day's paragraphs), so the
    // remembered list never grows beyond the current set.
    const current = new Set(paragraphs.map((p) => p.id));
    this.seen = store.load().filter((id) => current.has(id));
  }

  get size() {
    return this.paragraphs.length;
  }

  /** Paragraphs not yet dealt in this round. */
  get remaining() {
    return this.paragraphs.length - this.seen.length;
  }

  /** Next paragraph, or null when there are none (caller falls back to random words). */
  next(): Paragraph | null {
    if (this.paragraphs.length === 0) return null;
    if (this.remaining === 0) {
      // New round. Keep the one just shown so it can't come straight back.
      this.seen = this.paragraphs.length > 1 ? this.seen.slice(-1) : [];
    }
    const seen = new Set(this.seen);
    const unseen = this.paragraphs.filter((p) => !seen.has(p.id));
    const pick = unseen[Math.min(unseen.length - 1, Math.floor(this.random() * unseen.length))]!;
    this.seen.push(pick.id);
    this.store.save(this.seen);
    return pick;
  }
}
