import { useState } from "react";
import { WORD_LEVELS, levelLabel, type Language, type WordLevel } from "@typing/engine";
import type { Session } from "@typing/client-core";
import { BoardTable } from "./BoardTable";
import { useServices } from "./services";
import { Loading, Notice, useAsync } from "./ui";
import { formatDate } from "./format";

const TIME_VALUES = [15, 30, 60, 120];
const WORD_VALUES = [10, 25, 50, 100];
const PERIODS = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "all", label: "All time" },
] as const;

/** The weekly, monthly and all-time boards. Each is a student's best result for that language, level and length. */
export function LeaderboardScreen({ session }: { session: Session }) {
  const { api } = useServices();
  const [language, setLanguage] = useState<Language>("en");
  const [level, setLevel] = useState<WordLevel>(1000);
  const [mode, setMode] = useState<"time" | "words">("time");
  const [value, setValue] = useState(60);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>("week");
  const token = session.token;

  const board = useAsync(
    () => api.leaderboard(token!, { language, level, mode, value, period, limit: 50 }),
    [token, language, level, mode, value, period],
  );

  if (!token) {
    return (
      <main className="page narrow">
        <Notice tone="warn">
          Leaderboards need an internet connection. Log out and log in again while online to see them.
        </Notice>
      </main>
    );
  }

  const values = mode === "time" ? TIME_VALUES : WORD_VALUES;

  return (
    <main className="page">
      <div className="page-head">
        <h2>Leaderboard</h2>
        <button onClick={() => void board.reload()}>Refresh</button>
      </div>

      <div className="tabs">
        {PERIODS.map((p) => (
          <button key={p.id} className={period === p.id ? "tab on" : "tab"} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="filters-row">
        <label>
          Language
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
          </select>
        </label>
        <label>
          Words
          <select value={level} onChange={(e) => setLevel(Number(e.target.value) as WordLevel)}>
            {WORD_LEVELS.map((l) => (
              <option key={l} value={l}>
                {levelLabel(language, l)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Test
          <select
            value={mode}
            onChange={(e) => {
              const next = e.target.value as "time" | "words";
              setMode(next);
              setValue(next === "time" ? 60 : 50);
            }}
          >
            <option value="time">Time</option>
            <option value="words">Words</option>
          </select>
        </label>
        <label>
          {mode === "time" ? "Seconds" : "Word count"}
          <select value={value} onChange={(e) => setValue(Number(e.target.value))}>
            {values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      {board.loading && !board.data && <Loading />}
      {board.error && <Notice tone="bad">{board.error}</Notice>}
      {board.data && (
        <>
          <p className="muted">
            {board.data.period === "all" ? "Best ever" : `Best since ${formatDate(board.data.periodStart)}`} · only
            results with at least {board.data.minAccuracy}% accuracy count · plain text only (no punctuation or
            numbers)
          </p>
          <BoardTable
            entries={board.data.entries}
            me={board.data.me}
            myId={session.user.id}
            empty="Nobody has a result here yet. Take a test and be the first."
          />
        </>
      )}
    </main>
  );
}
