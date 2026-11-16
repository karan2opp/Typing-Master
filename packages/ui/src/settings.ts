import { DEFAULT_LEVEL, isWordLevel, type Language, type WordLevel } from "@typing/engine";

export type Mode = "time" | "words";

export interface Settings {
  language: Language;
  /** How deep into the word list tests draw from: 200, 1k, 5k or 10k. */
  level: WordLevel;
  mode: Mode;
  /** Seconds, for time mode. */
  time: number;
  /** Word count, for words mode. */
  words: number;
  punctuation: boolean;
  numbers: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "en",
  level: DEFAULT_LEVEL,
  mode: "time",
  time: 60,
  words: 50,
  punctuation: false,
  numbers: false,
};

export const LIMITS = {
  time: { min: 5, max: 3600 },
  words: { min: 1, max: 1000 },
} as const;

const KEY = "typing-master.settings.v1";

const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** Remembered per device so students don't re-pick their options each time. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Settings> & { durationMs?: number }) : {};
    // Older saves stored the duration in milliseconds.
    const time = p.time ?? (typeof p.durationMs === "number" ? p.durationMs / 1000 : undefined);
    return {
      language: p.language === "hi" ? "hi" : "en",
      level: isWordLevel(p.level) ? p.level : DEFAULT_LEVEL,
      mode: p.mode === "words" ? "words" : "time",
      time: clampInt(time, LIMITS.time.min, LIMITS.time.max, DEFAULT_SETTINGS.time),
      words: clampInt(p.words, LIMITS.words.min, LIMITS.words.max, DEFAULT_SETTINGS.words),
      punctuation: p.punctuation === true,
      numbers: p.numbers === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
