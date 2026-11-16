export type Language = "en" | "hi";

export interface KeyEventLike {
  code: string;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type ResolvedKey =
  | { type: "char"; char: string }
  | { type: "backspace" }
  | null;

export interface Layout {
  id: string;
  name: string;
  language: Language;
  /** Every code point this layout can produce, when that set is finite. */
  producible?: ReadonlySet<string>;
  resolve(e: KeyEventLike): ResolvedKey;
}

function common(e: KeyEventLike): ResolvedKey | undefined {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.code === "Backspace") return { type: "backspace" };
  if (e.code === "Space") return { type: "char", char: " " };
  return undefined;
}

/** English: the browser already gives us the right character in `key`. */
export const englishQwerty: Layout = {
  id: "en-qwerty",
  name: "English (QWERTY)",
  language: "en",
  resolve(e) {
    const c = common(e);
    if (c !== undefined) return c;
    return e.key.length === 1 ? { type: "char", char: e.key } : null;
  },
};

/**
 * Hindi Inscript (Devanagari, Unicode). Keyed by physical `KeyboardEvent.code`
 * as [normal, shift], so it does not depend on the Windows input language.
 */
const INSCRIPT: Record<string, readonly [string, string]> = {
  KeyQ: ["ौ", "औ"],
  KeyW: ["ै", "ऐ"],
  KeyE: ["ा", "आ"],
  KeyR: ["ी", "ई"],
  KeyT: ["ू", "ऊ"],
  KeyY: ["ब", "भ"],
  KeyU: ["ह", "ङ"],
  KeyI: ["ग", "घ"],
  KeyO: ["द", "ध"],
  KeyP: ["ज", "झ"],
  BracketLeft: ["ड", "ढ"],
  BracketRight: ["़", "ञ"],
  KeyA: ["ो", "ओ"],
  KeyS: ["े", "ए"],
  KeyD: ["्", "अ"],
  KeyF: ["ि", "इ"],
  KeyG: ["ु", "उ"],
  KeyH: ["प", "फ"],
  KeyJ: ["र", "ऱ"],
  KeyK: ["क", "ख"],
  KeyL: ["त", "थ"],
  Semicolon: ["च", "छ"],
  Quote: ["ट", "ठ"],
  KeyZ: ["ॆ", "ऎ"],
  KeyX: ["ं", "ँ"],
  KeyC: ["म", "ण"],
  KeyV: ["न", "ऩ"],
  KeyB: ["व", "ऴ"],
  KeyN: ["ल", "ळ"],
  KeyM: ["स", "श"],
  Comma: [",", "ष"],
  Period: [".", "।"],
  Slash: ["य", "य़"],
  Digit1: ["१", "ऍ"],
  Digit2: ["२", "ॅ"],
  Digit3: ["३", "्र"],
  Digit4: ["४", "र्"],
  Digit5: ["५", "ज्ञ"],
  Digit6: ["६", "त्र"],
  Digit7: ["७", "क्ष"],
  Digit8: ["८", "श्र"],
  Digit9: ["९", "("],
  Digit0: ["०", ")"],
  Minus: ["-", "ः"],
  Equal: ["ृ", "ऋ"],
};

export const hindiInscript: Layout = {
  id: "hi-inscript",
  name: "हिन्दी (Inscript)",
  language: "hi",
  producible: new Set(
    [" ", ...Object.values(INSCRIPT).flat()].flatMap((s) => Array.from(s)),
  ),
  resolve(e) {
    const c = common(e);
    if (c !== undefined) return c;
    const pair = INSCRIPT[e.code];
    if (!pair) return null;
    return { type: "char", char: e.shiftKey ? pair[1] : pair[0] };
  },
};

export const LAYOUTS: readonly Layout[] = [englishQwerty, hindiInscript];

export function getLayout(id: string): Layout {
  const layout = LAYOUTS.find((l) => l.id === id);
  if (!layout) throw new Error(`Unknown layout: ${id}`);
  return layout;
}
