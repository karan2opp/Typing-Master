import { useState, type FormEvent, type MouseEvent } from "react";
import { LIMITS, type Settings } from "./settings";

const TIME_PRESETS = [15, 30, 60, 120];
const WORD_PRESETS = [10, 25, 50, 100];

const Icon = ({ d }: { d: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CLOCK = "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2";
const WRENCH = "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z";

/**
 * Monkeytype-style options row. Every change starts a fresh test. Faded out
 * (and made inert) while the student is typing.
 */
export function FilterBar({
  settings,
  onChange,
  hidden,
}: {
  settings: Settings;
  onChange(patch: Partial<Settings>): void;
  hidden: boolean;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const { mode, punctuation, numbers } = settings;
  const presets = mode === "time" ? TIME_PRESETS : WORD_PRESETS;
  const value = mode === "time" ? settings.time : settings.words;
  const isCustom = !presets.includes(value);

  // Drop focus after a click so Space/Enter while typing can't re-press it.
  const pick = (patch: Partial<Settings>) => (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    setCustomOpen(false);
    onChange(patch);
  };

  const submitCustom = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = Number(new FormData(e.currentTarget).get("value"));
    if (!Number.isFinite(n) || n <= 0) return;
    const { min, max } = LIMITS[mode];
    const v = Math.min(max, Math.max(min, Math.round(n)));
    setCustomOpen(false);
    onChange(mode === "time" ? { time: v } : { words: v });
  };

  return (
    <div className={"filters" + (hidden ? " faded" : "")} inert={hidden}>
      <div className="filter-group">
        <button aria-pressed={punctuation} onClick={pick({ punctuation: !punctuation })}>
          <span className="glyph">@</span>punctuation
        </button>
        <button aria-pressed={numbers} onClick={pick({ numbers: !numbers })}>
          <span className="glyph">#</span>numbers
        </button>
      </div>

      <div className="filter-group">
        <button aria-pressed={mode === "time"} onClick={pick({ mode: "time" })}>
          <Icon d={CLOCK} />
          time
        </button>
        <button aria-pressed={mode === "words"} onClick={pick({ mode: "words" })}>
          <span className="glyph bold">A</span>words
        </button>
      </div>

      <div className="filter-group">
        {presets.map((n) => (
          <button
            key={n}
            aria-pressed={value === n}
            onClick={pick(mode === "time" ? { time: n } : { words: n })}
          >
            {n}
          </button>
        ))}
        <button
          aria-pressed={isCustom}
          aria-expanded={customOpen}
          aria-label={mode === "time" ? "Custom time" : "Custom word count"}
          title={mode === "time" ? "Custom time (seconds)" : "Custom word count"}
          onClick={(e) => {
            e.currentTarget.blur();
            setCustomOpen((o) => !o);
          }}
        >
          <Icon d={WRENCH} />
          {isCustom && value}
        </button>
      </div>

      {customOpen && (
        <form className="custom" onSubmit={submitCustom}>
          <input
            name="value"
            type="number"
            min={LIMITS[mode].min}
            max={LIMITS[mode].max}
            defaultValue={value}
            autoFocus
            onKeyDown={(e) => e.key === "Escape" && setCustomOpen(false)}
          />
          <span>{mode === "time" ? "seconds" : "words"}</span>
          <button type="submit">set</button>
        </form>
      )}
    </div>
  );
}
