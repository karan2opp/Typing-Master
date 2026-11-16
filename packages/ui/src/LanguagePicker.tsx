import { WORD_LEVELS, levelLabel, type Language, type WordLevel } from "@typing/engine";

const GLOBE =
  "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9";

/**
 * Language and difficulty in one list, like Monkeytype's language menu:
 * "english" is the 200 most common words, "english 10k" the top ten thousand.
 */
export function LanguagePicker({
  language,
  level,
  onChange,
}: {
  language: Language;
  level: WordLevel;
  onChange(language: Language, level: WordLevel): void;
}) {
  return (
    <label className="lang" title="Language and difficulty">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path d={GLOBE} fill="none" stroke="currentColor" strokeWidth="2.2" />
      </svg>
      <select
        aria-label="Language and difficulty"
        value={`${language}:${level}`}
        onChange={(e) => {
          const [l, lv] = e.target.value.split(":");
          // Let go of the control so the next key press types, not re-opens the list.
          e.target.blur();
          onChange(l as Language, Number(lv) as WordLevel);
        }}
      >
        {(["en", "hi"] as const).map((l) => (
          <optgroup key={l} label={l === "en" ? "English" : "हिन्दी (Inscript)"}>
            {WORD_LEVELS.map((lv) => (
              <option key={lv} value={`${l}:${lv}`}>
                {levelLabel(l, lv)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
