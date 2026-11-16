import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  buildTimeline,
  type LogEntry,
  type TypingResult,
} from "@typing/engine";
import type { HistoryEntry } from "@typing/client-core";
import { formatDateTime } from "./format";
import { WpmChart } from "./WpmChart";
import { Tip } from "./Tip";

export interface ResultsProps {
  result: TypingResult;
  text: string;
  log: readonly LogEntry[];
  durationMs: number;
  /** Lines describing the test, e.g. ["time 60", "english", "punctuation"]. */
  testType: string[];
  onAgain(): void;
  /** Label of the button under the stats. */
  againLabel?: string;
  /** Shown above the result, e.g. a hosted test's rank. */
  banner?: ReactNode;
  /** Earlier practice tests, newest first. Without it the table is not shown. */
  history?: HistoryEntry[];
}

const ROWS_PER_PAGE = 10;

export function Results({
  result,
  text,
  log,
  durationMs,
  testType,
  onAgain,
  againLabel = "Next test",
  banner,
  history,
}: ResultsProps) {
  const timeline = useMemo(() => buildTimeline(text, durationMs, log), [text, durationMs, log]);
  const [page, setPage] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Nothing is pre-selected: a student still typing when time runs out would
  // otherwise press "Next test" with Space and lose the results instantly.
  // Tab selects it (Monkeytype's "tab > enter"); after that Tab works normally.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || (document.activeElement && document.activeElement !== document.body)) return;
      e.preventDefault();
      nextRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  // This test heads the list, followed by the earlier ones, newest first.
  const thisTest: HistoryEntry = useMemo(
    () => ({
      id: "this-test",
      at: Date.now(),
      wpm: result.wpm,
      raw: result.rawWpm,
      accuracy: result.accuracy,
      consistency: timeline.consistency,
      label: testType.join(" · "),
    }),
    [result, timeline, testType],
  );
  const all = useMemo(() => [thisTest, ...(history ?? [])], [thisTest, history]);
  const pages = Math.max(1, Math.ceil(all.length / ROWS_PER_PAGE));
  const rows = all.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);

  return (
    <div className="results">
      {banner}
      <div className="res-top">
        <div className="res-hero">
          <div className="res-label">wpm</div>
          <Tip className="res-big" text={`${result.wpm.toFixed(2)} wpm`}>
            {Math.round(result.wpm)}
          </Tip>
          <div className="res-label">acc</div>
          <Tip
            className="res-big"
            text={`${result.accuracy.toFixed(2)}%\n${result.correctChars} correct\n${result.errors} not correct`}
          >
            {Math.round(result.accuracy)}%
          </Tip>
        </div>
        <WpmChart points={timeline.points} />
      </div>

      <div className="res-row">
        <div className="res-stat">
          <div className="res-label">test type</div>
          <div className="res-small">
            {testType.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
        <Tip className="res-stat" text={`${result.rawWpm.toFixed(2)} raw wpm`}>
          <div className="res-label">raw</div>
          <div className="res-value">{Math.round(result.rawWpm)}</div>
        </Tip>
        <Tip className="res-stat" text={"correct\nincorrect\nextra\nmissed"}>
          <div className="res-label">characters</div>
          <div className="res-value">
            {result.correctChars}/{result.incorrectChars}/{result.extraChars}/
            {result.missedChars}
          </div>
        </Tip>
        <Tip className="res-stat" text={`${timeline.consistency.toFixed(2)}%`}>
          <div className="res-label">consistency</div>
          <div className="res-value">{Math.round(timeline.consistency)}%</div>
        </Tip>
        <Tip className="res-stat" align="right" text={`${(result.elapsedMs / 1000).toFixed(2)}s`}>
          <div className="res-label">time</div>
          <div className="res-value">{Math.round(result.elapsedMs / 1000)}s</div>
        </Tip>
      </div>

      <div className="actions">
        <button ref={nextRef} className="primary" onClick={onAgain} title="Tab, then Enter">
          {againLabel}
        </button>
      </div>

      {history && (
      <details className="res-table">
        <summary>View as table</summary>
        <table>
          <thead>
            <tr>
              <th>when</th>
              <th>test</th>
              <th>wpm</th>
              <th>raw</th>
              <th>acc</th>
              <th>consistency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={e.id === thisTest.id ? "this-test" : undefined}>
                <td>{e.id === thisTest.id ? "this test" : formatDateTime(new Date(e.at))}</td>
                <td>{e.label}</td>
                <td>{Math.round(e.wpm)}</td>
                <td>{Math.round(e.raw)}</td>
                <td>{Math.round(e.accuracy)}%</td>
                <td>{Math.round(e.consistency)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pages > 1 && (
          <nav className="pager" aria-label="Table pages">
            <button onClick={() => setPage(0)} disabled={page === 0} aria-label="First page">
              «
            </button>
            <button onClick={() => setPage(page - 1)} disabled={page === 0} aria-label="Previous page">
              ‹
            </button>
            <span>
              {page + 1} / {pages}
            </span>
            <button onClick={() => setPage(page + 1)} disabled={page === pages - 1} aria-label="Next page">
              ›
            </button>
            <button onClick={() => setPage(pages - 1)} disabled={page === pages - 1} aria-label="Last page">
              »
            </button>
          </nav>
        )}
      </details>
      )}
    </div>
  );
}
