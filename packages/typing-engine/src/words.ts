import type { Language } from "./layouts";
import { EN } from "./wordlists/en";
import { HI } from "./wordlists/hi";

/**
 * Difficulty is how deep into a frequency-ranked list tests may reach: level
 * 200 uses only the 200 most common words, 10000 uses the whole list. The
 * lists are built by scripts/build-wordlists.mjs (sources in wordlists/README.md).
 */
export const WORD_LEVELS = [200, 1000, 5000, 10000] as const;
export type WordLevel = (typeof WORD_LEVELS)[number];

/** Large enough for variety, common enough that a student knows the words. */
export const DEFAULT_LEVEL: WordLevel = 1000;

export const isWordLevel = (n: unknown): n is WordLevel => WORD_LEVELS.includes(n as WordLevel);

/** The full ranked lists, most frequent word first. */
export const WORDS: Record<Language, readonly string[]> = {
  en: EN.split(" "),
  hi: HI.split(" "),
};

const slices = new Map<string, readonly string[]>();

/** The words a test at this difficulty may use. */
export function wordsFor(language: Language, level: WordLevel = DEFAULT_LEVEL): readonly string[] {
  const key = `${language}:${level}`;
  let list = slices.get(key);
  if (!list) {
    list = WORDS[language].slice(0, level);
    slices.set(key, list);
  }
  return list;
}

/** "english", "english 1k", "hindi 10k": how a language and level are shown to students. */
export function levelLabel(language: Language, level: WordLevel): string {
  const name = language === "en" ? "english" : "hindi";
  return level === 200 ? name : `${name} ${level / 1000}k`;
}
