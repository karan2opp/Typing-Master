import type { Language } from "./layouts";
import { DEFAULT_LEVEL, wordsFor, type WordLevel } from "./words";

export interface TextOptions {
  /** How deep into the frequency-ranked word list to draw from. */
  level?: WordLevel;
  /** Capitals and punctuation, in sentences. Off by default: plain lowercase words. */
  punctuation?: boolean;
  /** Mix random numbers in between the words. Off by default. */
  numbers?: boolean;
  random?: () => number;
}

/** Chance that any given word is a number when numbers are on. */
const NUMBER_RATE = 0.12;
/** Chance of a comma after a word inside a sentence. */
const COMMA_RATE = 0.08;

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

function randomNumber(language: Language, random: () => number): string {
  const length = 1 + Math.floor(random() * 4);
  let n = "";
  for (let i = 0; i < length; i++) n += Math.floor(random() * 10);
  return language === "hi"
    ? Array.from(n, (d) => DEVANAGARI_DIGITS[Number(d)]).join("")
    : n;
}

/** Sentence endings. Inscript has no "?" or "!", so Hindi only ends with "।". */
function sentenceEnd(language: Language, random: () => number): string {
  if (language === "hi") return "।";
  const r = random();
  return r < 0.8 ? "." : r < 0.9 ? "?" : "!";
}

/**
 * Endless stream of random words, so no two tests are alike. A word never
 * repeats within the last two picks.
 */
function* wordStream(
  language: Language,
  { level = DEFAULT_LEVEL, punctuation = false, numbers = false, random = Math.random }: TextOptions,
): Generator<string> {
  const list = wordsFor(language, level);
  const recent: number[] = [];
  let left = 0; // words left in the current sentence
  while (true) {
    let word: string;
    if (numbers && random() < NUMBER_RATE) {
      word = randomNumber(language, random);
    } else {
      // Step forward past recently used words. Bounded (at most 2 steps), so
      // it can never loop, whatever `random` returns.
      let i = Math.floor(random() * list.length);
      while (recent.includes(i)) i = (i + 1) % list.length;
      recent.push(i);
      if (recent.length > 2) recent.shift();
      word = list[i]!;
    }
    if (punctuation) {
      const startsSentence = left === 0;
      if (startsSentence) left = 4 + Math.floor(random() * 9); // 4-12 words
      if (startsSentence && language === "en") word = word[0]!.toUpperCase() + word.slice(1);
      left--;
      if (left === 0) word += sentenceEnd(language, random);
      else if (random() < COMMA_RATE) word += ",";
    }
    yield word;
  }
}

/**
 * Random words until there are at least `minChars` characters, so a fast
 * typist never runs out of text before the timer does.
 */
export function buildText(language: Language, minChars: number, options: TextOptions = {}): string {
  const words: string[] = [];
  let length = -1;
  for (const word of wordStream(language, options)) {
    words.push(word);
    length += 1 + Array.from(word).length;
    if (length >= minChars) break;
  }
  return words.join(" ");
}

/** Exactly `count` random words, for word-count tests. */
export function buildWords(language: Language, count: number, options: TextOptions = {}): string {
  const words: string[] = [];
  for (const word of wordStream(language, options)) {
    words.push(word);
    if (words.length >= count) break;
  }
  return words.join(" ");
}

/** Characters needed to cover a test: ~150 WPM is faster than any student. */
export function charsForDuration(durationMs: number): number {
  return Math.ceil((durationMs / 60_000) * 150 * 5);
}
