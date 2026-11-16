import { useEffect, useState, type FormEvent } from "react";
import type { Session, TestAttemptRow } from "@typing/client-core";
import { BoardTable } from "./BoardTable";
import { statusPill } from "./StaffTests";
import { useServices } from "./services";
import { Empty, Field, Loading, Modal, Notice, Pill, useAction, useAsync } from "./ui";
import { formatDateTime, formatDuration, languageName, toLocalInput } from "./format";

function WindowModal({
  startsAt,
  endsAt,
  onClose,
  onSave,
}: {
  startsAt: string;
  endsAt: string;
  onClose(): void;
  onSave(startsAt: string, endsAt: string): Promise<void>;
}) {
  const [start, setStart] = useState(toLocalInput(new Date(startsAt)));
  const [end, setEnd] = useState(toLocalInput(new Date(endsAt)));
  const { busy, error, setError, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!(new Date(end) > new Date(start))) return setError("The test must end after it starts.");
    void run(async () => {
      await onSave(new Date(start).toISOString(), new Date(end).toISOString());
      onClose();
    });
  };
  return (
    <Modal title="Change when the test is open" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label="Opens">
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </Field>
        <Field label="Closes">
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="row end">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AttemptsTable({ attempts, onFlag }: { attempts: TestAttemptRow[]; onFlag(a: TestAttemptRow, flagged: boolean): void }) {
  if (attempts.length === 0) return <Empty>Nobody has started this test yet.</Empty>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Student</th>
            <th className="num">WPM</th>
            <th className="num">Raw</th>
            <th className="num">Accuracy</th>
            <th>Started</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {attempts.map((a) => (
            <tr key={a.id} className={a.flagged ? "flagged" : undefined}>
              <td>
                {a.displayName}
                <span className="muted"> @{a.username}</span>
              </td>
              <td className="num strong">{a.submittedAt ? Math.round(a.wpm) : "–"}</td>
              <td className="num">{a.submittedAt ? Math.round(a.rawWpm) : "–"}</td>
              <td className="num">{a.submittedAt ? `${Math.round(a.accuracy)}%` : "–"}</td>
              <td>{formatDateTime(a.startedAt)}</td>
              <td>
                {!a.submittedAt ? (
                  <Pill>Typing or left</Pill>
                ) : a.flagged ? (
                  <Pill tone="warn">Held: {a.flagReason}</Pill>
                ) : (
                  <Pill tone="ok">Counted</Pill>
                )}
              </td>
              <td className="actions">
                {a.submittedAt && (
                  <button onClick={() => onFlag(a, !a.flagged)}>{a.flagged ? "Release" : "Hold"}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One test, for the teacher who set it or an admin: when it runs, who is winning, and every attempt. */
export function StaffTestDetail({ session, testId, back }: { session: Session; testId: string; back(): void }) {
  const { api } = useServices();
  const token = session.token!;
  const [editing, setEditing] = useState(false);
  const [showText, setShowText] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const act = useAction();

  const test = useAsync(() => api.getTest(token, testId), [testId]);
  const board = useAsync(() => api.testLeaderboard(token, testId, 100), [testId]);
  const attempts = useAsync(() => api.testAttempts(token, testId), [testId]);

  const t = test.data?.test;
  const refreshAll = async (quiet = true) => {
    await Promise.all([test.reload(quiet), board.reload(quiet), attempts.reload(quiet)]);
  };

  // Live while the test is open.
  useEffect(() => {
    if (t?.status !== "active") return;
    const timer = window.setInterval(() => void refreshAll(true), 15_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.status]);

  if (test.loading && !t) return <main className="page"><Loading /></main>;
  if (test.error && !t) {
    return (
      <main className="page">
        <Notice tone="bad">{test.error}</Notice>
        <p><button onClick={back}>Back to tests</button></p>
      </main>
    );
  }
  if (!t) return null;

  return (
    <main className="page">
      <p>
        <button className="link" onClick={back}>
          ← All tests
        </button>
      </p>
      <div className="page-head">
        <h2>{t.title}</h2>
        {statusPill(t.status)}
        <span className="grow" />
        <button onClick={() => void refreshAll(false)}>Refresh</button>
        {t.status !== "cancelled" && (
          <>
            <button onClick={() => setEditing(true)}>Change times</button>
            <button onClick={() => setConfirmCancel(true)}>Cancel test</button>
          </>
        )}
      </div>

      <p className="muted">
        {languageName(t.language)} · {formatDuration(t.durationSeconds)} · open {formatDateTime(t.startsAt)} to{" "}
        {formatDateTime(t.endsAt)} · {t.maxAttempts} attempt{t.maxAttempts === 1 ? "" : "s"} each
        {t.minAccuracy > 0 && ` · needs ${t.minAccuracy}% accuracy`} · {t.participants} took part
      </p>
      {act.error && <Notice tone="bad">{act.error}</Notice>}

      <p>
        <button className="link" onClick={() => setShowText((s) => !s)}>
          {showText ? "Hide the passage" : "Show the passage"}
        </button>
      </p>
      {showText && <pre className="passage-preview" lang={t.language}>{t.text}</pre>}

      <h3 className="section-title">Leaderboard</h3>
      {board.data ? (
        <BoardTable entries={board.data.entries} empty="Nobody has finished this test yet." />
      ) : (
        <Loading />
      )}

      <h3 className="section-title">Every attempt</h3>
      {attempts.error && <Notice tone="bad">{attempts.error}</Notice>}
      {attempts.data && (
        <AttemptsTable
          attempts={attempts.data.attempts}
          onFlag={(a, flagged) =>
            void act.run(async () => {
              await api.reviewAttempt(token, a.id, { flagged, reason: flagged ? "held by a teacher" : undefined });
              await refreshAll(true);
            })
          }
        />
      )}

      {editing && (
        <WindowModal
          startsAt={t.startsAt}
          endsAt={t.endsAt}
          onClose={() => setEditing(false)}
          onSave={async (startsAt, endsAt) => {
            await api.updateTest(token, t.id, { startsAt, endsAt });
            await refreshAll(true);
          }}
        />
      )}
      {confirmCancel && (
        <Modal title="Cancel this test?" onClose={() => setConfirmCancel(false)}>
          <div className="stack">
            <p>Students will no longer see it or be able to start it. Results already sent are kept.</p>
            <div className="row end">
              <button onClick={() => setConfirmCancel(false)}>Keep test</button>
              <button
                className="danger"
                onClick={() =>
                  void act.run(async () => {
                    await api.updateTest(token, t.id, { cancelled: true });
                    setConfirmCancel(false);
                    await refreshAll(true);
                  })
                }
              >
                Cancel test
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
