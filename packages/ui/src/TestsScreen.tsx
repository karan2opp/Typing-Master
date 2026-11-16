import { useState } from "react";
import type { Session, TestSummary } from "@typing/client-core";
import { BoardTable } from "./BoardTable";
import { HostedTest } from "./HostedTest";
import { useServices } from "./services";
import { Empty, Loading, Modal, Notice, Pill, useAsync } from "./ui";
import { formatDateTime, formatDuration, languageName } from "./format";

/** "in 2h 10m", "5m ago" */
function relative(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  const mins = Math.round(Math.abs(ms) / 60_000);
  const text = mins < 1 ? "less than a minute" : mins < 60 ? `${mins}m` : mins < 2880 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.round(mins / 1440)} days`;
  return ms >= 0 ? `in ${text}` : `${text} ago`;
}

function TestCard({ test, onStart, onBoard }: { test: TestSummary; onStart(): void; onBoard(): void }) {
  const used = test.myAttempts ?? 0;
  const left = test.maxAttempts - used;
  const canStart = test.status === "active" && left > 0;
  return (
    <div className="card test-card">
      <div className="test-card-head">
        <h3>{test.title}</h3>
        {test.status === "active" && <Pill tone="ok">Open</Pill>}
        {test.status === "upcoming" && <Pill tone="info">Upcoming</Pill>}
        {test.status === "ended" && <Pill>Closed</Pill>}
      </div>
      <p className="muted">
        {languageName(test.language)} · {formatDuration(test.durationSeconds)}
        {test.minAccuracy > 0 && ` · needs ${test.minAccuracy}% accuracy`}
      </p>
      <p className="muted">
        {test.status === "upcoming" && `Opens ${formatDateTime(test.startsAt)} (${relative(test.startsAt)})`}
        {test.status === "active" && `Closes ${formatDateTime(test.endsAt)} (${relative(test.endsAt)})`}
        {test.status === "ended" && `Closed ${formatDateTime(test.endsAt)}`}
      </p>
      <p>
        Attempts: {used} of {test.maxAttempts}
        {test.myBestWpm != null && (
          <>
            {" "}
            · your best <strong>{Math.round(test.myBestWpm)} WPM</strong>
          </>
        )}
      </p>
      <div className="row">
        {test.status === "active" && (
          <button className="primary" onClick={onStart} disabled={!canStart}>
            {used === 0 ? "Start test" : left > 0 ? "Try again" : "No attempts left"}
          </button>
        )}
        <button onClick={onBoard}>Leaderboard</button>
      </div>
    </div>
  );
}

function BoardModal({ test, session, onClose }: { test: TestSummary; session: Session; onClose(): void }) {
  const { api } = useServices();
  const board = useAsync(() => api.testLeaderboard(session.token!, test.id, 100), [test.id]);
  return (
    <Modal title={`${test.title} — leaderboard`} onClose={onClose} wide>
      {board.loading && !board.data && <Loading />}
      {board.error && <Notice tone="bad">{board.error}</Notice>}
      {board.data && (
        <BoardTable
          entries={board.data.entries}
          me={board.data.me}
          myId={session.user.id}
          empty="Nobody has finished this test yet."
        />
      )}
    </Modal>
  );
}

export function TestsScreen({ session }: { session: Session }) {
  const { api } = useServices();
  const [running, setRunning] = useState<TestSummary | null>(null);
  const [board, setBoard] = useState<TestSummary | null>(null);
  const token = session.token;
  const tests = useAsync(() => api.listTests(token!, { limit: 100 }), [token]);

  if (!token) {
    return (
      <main className="page narrow">
        <Notice tone="warn">
          Hosted tests need an internet connection and a login from this session. Log out and log in again while
          online.
        </Notice>
      </main>
    );
  }

  if (running) {
    return (
      <HostedTest
        test={running}
        token={token}
        onClose={() => {
          setRunning(null);
          void tests.reload();
        }}
      />
    );
  }

  const list = tests.data?.tests ?? [];
  const groups: [string, TestSummary[]][] = [
    ["Open now", list.filter((t) => t.status === "active")],
    ["Coming up", list.filter((t) => t.status === "upcoming").reverse()],
    ["Past tests", list.filter((t) => t.status === "ended")],
  ];

  return (
    <main className="page">
      <div className="page-head">
        <h2>Tests</h2>
        <button onClick={() => void tests.reload()}>Refresh</button>
      </div>
      {tests.loading && !tests.data && <Loading />}
      {tests.error && <Notice tone="bad">{tests.error}</Notice>}
      {tests.data && list.length === 0 && <Empty>Your teachers have not set any tests yet.</Empty>}
      {groups.map(
        ([title, items]) =>
          items.length > 0 && (
            <section key={title}>
              <h3 className="section-title">{title}</h3>
              <div className="grid">
                {items.map((t) => (
                  <TestCard key={t.id} test={t} onStart={() => setRunning(t)} onBoard={() => setBoard(t)} />
                ))}
              </div>
            </section>
          ),
      )}
      {board && <BoardModal test={board} session={session} onClose={() => setBoard(null)} />}
    </main>
  );
}
