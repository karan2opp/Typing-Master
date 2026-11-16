import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEVEL,
  PassageDeck,
  TypingSession,
  WORDS,
  WORD_LEVELS,
  isWordLevel,
  levelLabel,
  wordsFor,
  buildText,
  buildTimeline,
  buildWords,
  charsForDuration,
  computeMetrics,
  englishQwerty,
  hashPassword,
  isPasswordHash,
  verifyPassword,
  hindiInscript,
  replayLog,
} from "./index";

const key = (code: string, k = "", shiftKey = false) => ({
  code,
  key: k,
  shiftKey,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
});

describe("computeMetrics", () => {
  it("counts only correct characters: 300 chars, 12 wrong, 1 minute", () => {
    const m = computeMetrics({ typedChars: 300, correctChars: 288, elapsedMs: 60_000 });
    expect(m.rawWpm).toBe(60);
    expect(m.wpm).toBe(57.6);
    expect(m.accuracy).toBe(96);
    expect(m.errors).toBe(12);
  });

  it("matches a real Monkeytype result: 218 correct chars in 37s is ~70 wpm", () => {
    const m = computeMetrics({ typedChars: 238, correctChars: 218, elapsedMs: 37_000 });
    expect(Math.round(m.wpm)).toBe(71);
  });

  it("counts missed letters as attempted for accuracy", () => {
    const m = computeMetrics({
      typedChars: 4,
      correctChars: 4,
      missedChars: 7,
      elapsedMs: 60_000,
    });
    expect(m.accuracy).toBe(36.36);
    expect(m.errors).toBe(7);
  });

  it("is zero when every character is wrong", () => {
    const m = computeMetrics({ typedChars: 10, correctChars: 0, elapsedMs: 60_000 });
    expect(m.wpm).toBe(0);
  });

  it("returns zeros when nothing has happened", () => {
    expect(computeMetrics({ typedChars: 0, correctChars: 0, elapsedMs: 0 })).toEqual({
      errors: 0,
      wpm: 0,
      rawWpm: 0,
      accuracy: 0,
    });
  });
});

describe("TypingSession", () => {
  it("starts the clock on the first keystroke", () => {
    const s = new TypingSession("hello", 60_000);
    expect(s.status).toBe("idle");
    s.input("h", 5_000);
    expect(s.status).toBe("running");
    expect(s.log[0]).toEqual({ t: 0, c: "h" });
  });

  it("counts corrected mistakes separately from uncorrected errors", () => {
    const s = new TypingSession("cat", 60_000);
    s.input("c", 0);
    s.input("x", 100);
    s.backspace(200);
    s.input("a", 300);
    s.input("t", 400);
    const r = s.result();
    expect(s.status).toBe("finished");
    expect(r.errors).toBe(0);
    expect(r.mistakes).toBe(1);
    expect(r.backspaces).toBe(1);
    expect(r.accuracy).toBe(100);
  });

  it("finishes when the timer runs out and ignores later input", () => {
    const s = new TypingSession("hello world", 1_000);
    s.input("h", 0);
    expect(s.tick(1_000)).toBe(true);
    expect(s.input("e", 1_100)).toBe(false);
    expect(s.result().typedChars).toBe(1);
    expect(s.result().elapsedMs).toBe(1_000);
  });

  it("does not run past the end of the passage", () => {
    const s = new TypingSession("ab", 60_000);
    s.input("a", 0);
    s.input("b", 10);
    expect(s.input("c", 20)).toBe(false);
    expect(s.result().typedChars).toBe(2);
  });

  it("backspace on a wrong character does not reduce the correct count", () => {
    const s = new TypingSession("ab", 60_000);
    s.input("a", 0);
    s.input("x", 10);
    s.backspace(20);
    expect(s.result().correctChars).toBe(1);
  });

  it("handles multi-code-point Hindi output", () => {
    const s = new TypingSession("र्क", 60_000);
    s.input("र्", 0);
    s.input("क", 10);
    expect(s.result().accuracy).toBe(100);
  });
});

describe("Space moves to the next word", () => {
  const type = (s: TypingSession, keys: string, from = 0) => {
    keys.split("").forEach((c, i) => s.input(c, from + i * 100));
  };

  it("skips the rest of the word after one letter: c + Space", () => {
    const s = new TypingSession("computer is", 60_000);
    type(s, "c ");
    expect(s.typedLength).toBe(9); // c + 7 skipped + space; "is" starts at 9
    type(s, "is", 200);
    const r = s.result();
    expect(s.status).toBe("finished");
    expect(r.correctChars).toBe(4); // c, space, i, s
    expect(r.missedChars).toBe(7);
    expect(r.incorrectChars).toBe(0);
  });

  it("skips the rest of the word after three letters: com + Space", () => {
    const s = new TypingSession("computer is", 60_000);
    type(s, "com ");
    expect(s.typedLength).toBe(9);
    expect(s.result().missedChars).toBe(5); // p u t e r
  });

  it("marks skipped letters as missed, not as typed text", () => {
    const s = new TypingSession("computer is", 60_000);
    type(s, "co ");
    expect(s.isSkippedAt(1)).toBe(false);
    expect(s.isSkippedAt(2)).toBe(true);
    expect(s.isSkippedAt(7)).toBe(true);
    expect(s.isCorrectAt(8)).toBe(true); // the space
  });

  it("counts skipped letters against accuracy but not raw speed", () => {
    const s = new TypingSession("computer is", 60_000);
    type(s, "c ");
    const r = s.result(60_000);
    expect(r.typedChars).toBe(2); // only "c" and the space were typed
    expect(r.accuracy).toBe(22.22); // 2 correct of 9 attempted
  });

  it("Space behaves normally at the end of a finished word", () => {
    const s = new TypingSession("go on", 60_000);
    type(s, "go ");
    expect(s.typedLength).toBe(3);
    expect(s.result().missedChars).toBe(0);
  });

  it("ignores Space at the start of a word", () => {
    const s = new TypingSession("ab cd", 60_000);
    expect(s.input(" ", 0)).toBe(false);
    expect(s.status).toBe("idle"); // does not start the clock
    type(s, "ab ", 100);
    expect(s.input(" ", 500)).toBe(false);
    expect(s.typedLength).toBe(3);
    expect(s.log.map((e) => e.c).join("")).toBe("ab ");
  });

  it("counts letters past the end of a word as extra without moving on", () => {
    const s = new TypingSession("ab cd", 60_000);
    type(s, "abx");
    expect(s.typedLength).toBe(2);
    type(s, " ", 300);
    expect(s.typedLength).toBe(3); // next word starts cleanly
    const r = s.result();
    expect(r.extraChars).toBe(1);
    expect(r.mistakes).toBe(1);
  });

  it("backspace over a skipping Space returns to where the word was left", () => {
    const s = new TypingSession("computer is", 60_000);
    type(s, "com ");
    s.backspace(500);
    expect(s.typedLength).toBe(3);
    expect(s.result().missedChars).toBe(0);
    type(s, "puter", 600);
    expect(s.result().correctChars).toBe(8);
  });

  it("skipping the last word finishes the test", () => {
    const s = new TypingSession("go on", 60_000);
    type(s, "go o ");
    expect(s.status).toBe("finished");
    expect(s.result().missedChars).toBe(1);
  });

  it("replays skips exactly", () => {
    const text = "computer science is fun";
    const live = new TypingSession(text, 10_000);
    const script: [string, number][] = [
      ["c", 0], ["o", 100], [" ", 200], ["x", 300], ["i", 400], ["z", 500],
      ["\b", 600], [" ", 700], ["i", 800], ["s", 900],
    ];
    for (const [c, t] of script) {
      if (c === "\b") live.backspace(t);
      else live.input(c, t);
    }
    live.finish(10_000);
    expect(replayLog(text, 10_000, live.log)).toEqual(live.result());
  });
});

describe("buildTimeline", () => {
  /** Types `count` characters of `text` at a steady `cps` per second. */
  const steady = (text: string, durationMs: number, cps: number, count: number) => {
    const s = new TypingSession(text, durationMs);
    Array.from(text)
      .slice(0, count)
      .forEach((c, i) => s.input(c, (i * 1000) / cps));
    s.finish(durationMs);
    return s;
  };

  it("gives one point per second with steady speed and full consistency", () => {
    const text = "a".repeat(100);
    const s = steady(text, 3_000, 10, 30);
    const tl = buildTimeline(text, 3_000, s.log);
    expect(tl.points.map((p) => p.second)).toEqual([1, 2, 3]);
    expect(tl.points.map((p) => p.burst)).toEqual([120, 120, 120]);
    expect(tl.points.map((p) => p.wpm)).toEqual([120, 120, 120]);
    expect(tl.consistency).toBe(100);
  });

  it("ends on the same WPM as the final result", () => {
    const text = "the quick brown fox jumps";
    const s = new TypingSession(text, 5_000);
    "the qx".split("").forEach((c, i) => s.input(c, i * 300));
    s.backspace(1_900);
    "uick".split("").forEach((c, i) => s.input(c, 2_100 + i * 400));
    s.finish(5_000);
    const tl = buildTimeline(text, 5_000, s.log);
    expect(tl.points.at(-1)!.wpm).toBe(s.result().wpm);
    expect(tl.points.at(-1)!.second).toBe(5);
  });

  it("puts errors in the second they were made", () => {
    const text = "abcdef";
    const s = new TypingSession(text, 3_000);
    s.input("a", 0);
    s.input("x", 1_200); // wrong, during second 2
    s.finish(3_000);
    const tl = buildTimeline(text, 3_000, s.log);
    expect(tl.points.map((p) => p.errors)).toEqual([0, 1, 0]);
  });

  it("folds a final sliver under half a second into the previous point", () => {
    const text = "abcd";
    const s = new TypingSession(text, 60_000);
    ["a", "b", "c", "d"].forEach((c, i) => s.input(c, [0, 400, 800, 1_200][i]!));
    expect(s.status).toBe("finished"); // passage done at 1.2s
    const tl = buildTimeline(text, 60_000, s.log);
    expect(tl.points).toHaveLength(1);
    expect(tl.points[0]!.second).toBe(1.2);
  });

  it("drops consistency when speed is uneven", () => {
    const text = "a".repeat(40);
    const s = new TypingSession(text, 4_000);
    let t = 0;
    for (const perSecond of [10, 2, 10, 2]) {
      for (let k = 0; k < perSecond; k++) s.input("a", t + (k * 1000) / perSecond);
      t += 1000;
    }
    s.finish(4_000);
    expect(buildTimeline(text, 4_000, s.log).consistency).toBeLessThan(60);
  });

  it("is empty for an attempt with no keys", () => {
    expect(buildTimeline("abc", 60_000, [])).toEqual({ points: [], consistency: 0 });
  });
});

describe("replayLog", () => {
  it("reproduces the live result exactly", () => {
    const text = "the quick brown fox";
    const live = new TypingSession(text, 5_000);
    const script: [string, number][] = [
      ["t", 0], ["h", 120], ["x", 240], ["\b", 360], ["e", 480], [" ", 600],
      ["q", 720], ["u", 840], ["i", 960], ["c", 1080], ["k", 1200],
    ];
    for (const [c, t] of script) {
      if (c === "\b") live.backspace(t);
      else live.input(c, t);
    }
    live.finish(5_000);
    const replayed = replayLog(text, 5_000, live.log);
    expect(replayed).toEqual(live.result());
  });

  it("is deterministic regardless of wall-clock offset", () => {
    const a = new TypingSession("ab", 60_000);
    a.input("a", 1_000_000);
    a.input("b", 1_000_500);
    expect(a.log).toEqual([
      { t: 0, c: "a" },
      { t: 500, c: "b" },
    ]);
  });
});

describe("layouts", () => {
  it("english uses the produced character", () => {
    expect(englishQwerty.resolve(key("KeyA", "A", true))).toEqual({ type: "char", char: "A" });
    expect(englishQwerty.resolve(key("Space", " "))).toEqual({ type: "char", char: " " });
    expect(englishQwerty.resolve(key("Backspace", "Backspace"))).toEqual({ type: "backspace" });
    expect(englishQwerty.resolve(key("ShiftLeft", "Shift"))).toBeNull();
  });

  it("inscript maps by physical key, ignoring the OS layout", () => {
    expect(hindiInscript.resolve(key("KeyK", "k"))).toEqual({ type: "char", char: "क" });
    expect(hindiInscript.resolve(key("KeyK", "K", true))).toEqual({ type: "char", char: "ख" });
    expect(hindiInscript.resolve(key("KeyD", "d"))).toEqual({ type: "char", char: "्" });
  });

  it("ignores shortcut combos", () => {
    const e = { ...key("KeyC", "c"), ctrlKey: true };
    expect(englishQwerty.resolve(e)).toBeNull();
    expect(hindiInscript.resolve(e)).toBeNull();
  });
});

describe("word lists", () => {
  it("every Hindi word can be typed with Inscript", () => {
    const missing = WORDS.hi.filter((w) => Array.from(w).some((c) => !hindiInscript.producible!.has(c)));
    expect(missing).toEqual([]);
  });

  it("every English word is plain lowercase letters", () => {
    expect(WORDS.en.filter((w) => !/^[a-z]+$/.test(w))).toEqual([]);
  });

  it("has no duplicate words", () => {
    for (const list of [WORDS.en, WORDS.hi]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("has ten thousand words in each language", () => {
    expect(WORDS.en).toHaveLength(10_000);
    expect(WORDS.hi).toHaveLength(10_000);
  });

  it("starts with the words everyone knows", () => {
    expect(WORDS.en.slice(0, 10)).toEqual(expect.arrayContaining(["the", "of", "and", "to", "a", "in"]));
    expect(WORDS.hi.slice(0, 10)).toEqual(expect.arrayContaining(["के", "में", "की", "और", "है"]));
  });

  it("leaves out words a school app should not offer", () => {
    for (const w of ["allah", "jesus", "html", "www", "usb", "ic", "ny"]) expect(WORDS.en).not.toContain(w);
  });

  it("only has well-formed Hindi words, not stray vowel signs or half-words", () => {
    const first = /^[ऀ-ः़-ॏ]/u; // starts with a mark that must follow a letter
    const endsInVirama = /्$/u;
    expect(WORDS.hi.filter((w) => first.test(w) || endsInVirama.test(w))).toEqual([]);
  });
});

describe("difficulty levels", () => {
  it("nest: each level is the front of the next", () => {
    for (const language of ["en", "hi"] as const) {
      for (let i = 1; i < WORD_LEVELS.length; i++) {
        const small = wordsFor(language, WORD_LEVELS[i - 1]);
        const big = wordsFor(language, WORD_LEVELS[i]);
        expect(big.slice(0, small.length)).toEqual(small);
      }
      expect(WORD_LEVELS.map((l) => wordsFor(language, l).length)).toEqual([200, 1000, 5000, 10000]);
    }
  });

  it("generates tests only from the chosen level", () => {
    for (const language of ["en", "hi"] as const) {
      for (const level of WORD_LEVELS) {
        const allowed = new Set(wordsFor(language, level));
        const words = buildText(language, 2_000, { level }).split(" ");
        expect(words.filter((w) => !allowed.has(w))).toEqual([]);
      }
    }
  });

  it("uses a mid level by default", () => {
    expect(DEFAULT_LEVEL).toBe(1000);
    const allowed = new Set(wordsFor("en", 1000));
    expect(buildWords("en", 300).split(" ").every((w) => allowed.has(w))).toBe(true);
  });

  it("still varies a lot at the easiest level", () => {
    const words = buildText("en", 5_000, { level: 200 }).split(" ");
    expect(new Set(words).size).toBeGreaterThan(150);
  });

  it("recognises levels and labels them like Monkeytype", () => {
    expect([200, 1000, 5000, 10000].every(isWordLevel)).toBe(true);
    expect(isWordLevel(300)).toBe(false);
    expect(levelLabel("en", 200)).toBe("english");
    expect(levelLabel("en", 1000)).toBe("english 1k");
    expect(levelLabel("hi", 10000)).toBe("hindi 10k");
  });
});

describe("text generation", () => {
  it("is different every time", () => {
    const tests = Array.from({ length: 20 }, () => buildText("en", 300));
    expect(new Set(tests).size).toBe(20);
    expect(buildWords("hi", 25)).not.toBe(buildWords("hi", 25));
  });

  it("never repeats a word within two words", () => {
    const words = buildText("en", 20_000).split(" ");
    const close = words.filter((w, i) => w === words[i - 1] || w === words[i - 2]);
    expect(close).toEqual([]);
  });

  it("buildText reaches the requested length", () => {
    const t = buildText("hi", 3_000, { random: () => 0.5 });
    expect(Array.from(t).length).toBeGreaterThanOrEqual(3_000);
  });

  it("defaults to lowercase words with no punctuation or numbers", () => {
    expect(buildText("en", 2_000)).toMatch(/^[a-z]+( [a-z]+)*$/);
    expect(buildText("hi", 2_000)).not.toMatch(/[\p{P}0-9०-९]/u);
  });

  it("writes capitalised sentences when punctuation is on", () => {
    const t = buildText("en", 2_000, { punctuation: true });
    expect(t[0]).toMatch(/[A-Z]/);
    expect(t).toMatch(/[.?!] [A-Z]/); // a new sentence starts with a capital
    expect(t).toMatch(/,/);
    expect(buildText("hi", 2_000, { punctuation: true })).toContain("।");
  });

  it("only uses punctuation Inscript can type in Hindi", () => {
    const t = buildText("hi", 5_000, { punctuation: true });
    expect(t).not.toMatch(/[?!.]/);
  });

  it("mixes in numbers when numbers is on, in the layout's own digits", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    expect(buildText("en", 2_000, { numbers: true, random })).toMatch(/\b\d{1,4}\b/);
    expect(buildText("hi", 2_000, { numbers: true, random })).toMatch(/[०-९]/);
  });

  it("every option combination stays typeable in Hindi", () => {
    for (const punctuation of [false, true]) {
      for (const numbers of [false, true]) {
        const t = buildText("hi", 1_500, { punctuation, numbers });
        const missing = Array.from(t).filter((c) => !hindiInscript.producible!.has(c));
        expect(missing).toEqual([]);
      }
    }
  });

  it("buildWords gives exactly the requested number of words", () => {
    for (const count of [10, 25, 50, 100]) {
      expect(buildWords("en", count).split(" ")).toHaveLength(count);
      expect(buildWords("hi", count, { numbers: true }).split(" ")).toHaveLength(count);
      expect(buildWords("en", count, { punctuation: true }).split(" ")).toHaveLength(count);
    }
  });

  it("charsForDuration covers a 1 minute test", () => {
    expect(charsForDuration(60_000)).toBe(750);
  });
});

describe("PassageDeck", () => {
  const set = (n: number, prefix = "p") =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, language: "en" as const, text: `text ${i}` }));
  const memory = (initial: string[] = []) => {
    let saved = initial;
    return { load: () => saved, save: (ids: string[]) => (saved = [...ids]), peek: () => saved };
  };

  it("never repeats a paragraph until the whole set has been dealt", () => {
    const deck = new PassageDeck(set(300), memory());
    const dealt = Array.from({ length: 300 }, () => deck.next()!.id);
    expect(new Set(dealt).size).toBe(300);
    expect(deck.remaining).toBe(0);
  });

  it("covers a 2-hour session of the fastest typist (about 140) with no repeats", () => {
    const deck = new PassageDeck(set(300), memory());
    const dealt = Array.from({ length: 140 }, () => deck.next()!.id);
    expect(new Set(dealt).size).toBe(140);
  });

  it("starts a new round after the set is used, without an immediate repeat", () => {
    const deck = new PassageDeck(set(5), memory(), () => 0);
    const first = Array.from({ length: 5 }, () => deck.next()!.id);
    const sixth = deck.next()!.id;
    expect(sixth).not.toBe(first[4]);
    expect(first).toContain(sixth); // it is one of the same five
    // The carried-over paragraph and the one just dealt are both marked used.
    expect(deck.remaining).toBe(3);
  });

  it("remembers what was dealt after the app is restarted", () => {
    const store = memory();
    const a = new PassageDeck(set(10), store);
    const before = Array.from({ length: 4 }, () => a.next()!.id);
    const b = new PassageDeck(set(10), store); // same device, app reopened
    const after = Array.from({ length: 6 }, () => b.next()!.id);
    expect(new Set([...before, ...after]).size).toBe(10);
  });

  it("forgets paragraphs that belong to an older day's set", () => {
    const store = memory(["old1", "old2", "p0"]);
    const deck = new PassageDeck(set(3), store);
    expect(deck.remaining).toBe(2); // only p0 counts as seen
    deck.next();
    expect(store.peek().every((id) => id.startsWith("p"))).toBe(true);
  });

  it("returns null when there are no paragraphs, so the caller uses random words", () => {
    expect(new PassageDeck([], memory()).next()).toBeNull();
  });

  it("keeps working with a single paragraph", () => {
    const deck = new PassageDeck(set(1), memory());
    expect(deck.next()!.id).toBe("p0");
    expect(deck.next()!.id).toBe("p0");
  });

  it("copes with a random function stuck at 1", () => {
    const deck = new PassageDeck(set(3), memory(), () => 1);
    expect(new Set([deck.next()!.id, deck.next()!.id, deck.next()!.id]).size).toBe(3);
  });
});

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("correct horse ", hash)).toBe(false);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("salts every hash differently", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("treats the same text typed in different Unicode forms alike", async () => {
    const hash = await hashPassword("école"); // e + combining accent
    expect(await verifyPassword("école", hash)).toBe(true); // precomposed é
  });

  it("recognises a well-formed hash and nothing else", async () => {
    expect(isPasswordHash(await hashPassword("x"))).toBe(true);
    expect(isPasswordHash("hunter2")).toBe(false);
    expect(isPasswordHash("pbkdf2-sha256$100000$abc$def")).toBe(false);
  });

  it("refuses hashes whose work factor could slow the server down", async () => {
    const absurd = await hashPassword("x", 50_000);
    expect(isPasswordHash(absurd)).toBe(true);
    expect(isPasswordHash(absurd.replace("$50000$", "$900000000$"))).toBe(false);
    expect(isPasswordHash(absurd.replace("$50000$", "$1000$"))).toBe(false);
    expect(await verifyPassword("x", absurd.replace("$50000$", "$900000000$"))).toBe(false);
  });

  it("never throws on junk stored values", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not a hash at all")).toBe(false);
  });
});

describe("performance", () => {
  it("handles 10 minutes of fast typing in well under a second", () => {
    const text = "a".repeat(20_000);
    const s = new TypingSession(text, 600_000);
    const start = performance.now();
    for (let i = 0; i < 9_000; i++) s.input("a", i * 66);
    expect(performance.now() - start).toBeLessThan(200);
    expect(s.result().typedChars).toBe(9_000);
  });
});
