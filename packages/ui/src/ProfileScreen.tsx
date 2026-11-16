import { useState, type FormEvent } from "react";
import { checkPassword, type Session, type SyncSnapshot } from "@typing/client-core";
import { useServices } from "./services";
import { Empty, Loading, Notice, Pill, PrevNext, useAction, useAsync } from "./ui";
import { boardLabel, formatDateTime } from "./format";

const PAGE = 10;

function ChangePassword({ token }: { token: string }) {
  const { api } = useServices();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = checkPassword(next);
    if (problem) return setError(problem);
    setDone(false);
    void run(async () => {
      await api.changePassword(token, { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setDone(true);
    });
  };

  return (
    <form onSubmit={submit} className="stack narrow-form">
      <h3 className="section-title">Change password</h3>
      <input type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      <input type="password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
      {error && <Notice tone="bad">{error}</Notice>}
      {done && <Notice tone="ok">Password changed.</Notice>}
      <button type="submit" disabled={busy}>
        Change password
      </button>
    </form>
  );
}

export function ProfileScreen({
  session,
  snapshot,
  syncNow,
}: {
  session: Session;
  snapshot: SyncSnapshot;
  syncNow(): Promise<void>;
}) {
  const { api, queue } = useServices();
  const token = session.token;
  const [page, setPage] = useState(0);
  const history = useAsync(
    () => api.userAttempts(token!, session.user.id, { limit: PAGE + 1, offset: page * PAGE }),
    [token, page, snapshot.pendingResults],
  );

  return (
    <main className="page">
      <div className="page-head">
        <h2>{session.user.displayName}</h2>
        <span className="muted">@{session.user.username}</span>
      </div>

      {snapshot.pendingResults > 0 && (
        <Notice
          tone="warn"
          action={
            token && (
              <button onClick={() => void syncNow()}>Upload now</button>
            )
          }
        >
          {snapshot.pendingResults} result{snapshot.pendingResults === 1 ? " is" : "s are"} waiting on this computer
          to be uploaded.
          {!token && " Log in again while online to send them."}
        </Notice>
      )}
      {snapshot.rejectedResults > 0 && (
        <Notice
          tone="bad"
          action={
            <button
              onClick={async () => {
                await queue.clearRejected(session.user.id);
                await syncNow();
              }}
            >
              Dismiss
            </button>
          }
        >
          {snapshot.rejectedResults} result{snapshot.rejectedResults === 1 ? " was" : "s were"} refused by the server and
          not saved.
        </Notice>
      )}

      {!token ? (
        <Notice tone="info">
          Your history is on the server. Log in while online to see it.
        </Notice>
      ) : (
        <>
          <h3 className="section-title">Personal bests</h3>
          {history.loading && !history.data && <Loading />}
          {history.error && <Notice tone="bad">{history.error}</Notice>}
          {history.data &&
            (history.data.bests.length === 0 ? (
              <Empty>No bests yet. Finish a test with at least 90% accuracy to set one.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Test</th>
                      <th className="num">WPM</th>
                      <th className="num">Accuracy</th>
                      <th>Set on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.data.bests.map((b) => (
                      <tr key={b.board}>
                        <td>{boardLabel(b.board)}</td>
                        <td className="num strong">{Math.round(b.wpm)}</td>
                        <td className="num">{Math.round(b.accuracy)}%</td>
                        <td>{formatDateTime(b.achievedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

          <h3 className="section-title">Recent tests</h3>
          {history.data &&
            (history.data.attempts.length === 0 ? (
              <Empty>Nothing yet. Your finished tests will appear here.</Empty>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Test</th>
                        <th className="num">WPM</th>
                        <th className="num">Accuracy</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.attempts.slice(0, PAGE).map((a) => (
                        <tr key={a.id}>
                          <td>{formatDateTime(a.submittedAt)}</td>
                          <td>{a.testTitle ?? boardLabel(a.board)}</td>
                          <td className="num strong">{Math.round(a.wpm)}</td>
                          <td className="num">{Math.round(a.accuracy)}%</td>
                          <td>{a.flagged && <Pill tone="warn">held for review</Pill>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PrevNext page={page} hasMore={history.data.attempts.length > PAGE} onPage={setPage} />
              </>
            ))}

          <ChangePassword token={token} />
        </>
      )}
    </main>
  );
}
