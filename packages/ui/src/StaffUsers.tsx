import { useEffect, useState, type FormEvent } from "react";
import { checkPassword, checkUsername, type Role, type Session, type User } from "@typing/client-core";
import { useServices } from "./services";
import { Empty, Field, Loading, Modal, Notice, Pager, Pill, useAction, useAsync } from "./ui";
import { boardLabel, formatDate, formatDateTime, randomPassword } from "./format";

const PAGE = 20;
const roleName: Record<Role, string> = { admin: "Admin", teacher: "Teacher", student: "Student" };

function PasswordField({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <Field label="Password" hint="At least 6 characters. You can generate one and give it to the person.">
      <div className="row">
        <input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} autoComplete="off" required />
        <button type="button" onClick={() => onChange(randomPassword())}>
          Generate
        </button>
      </div>
    </Field>
  );
}

/** Shows the details once, so they can be written down or read out. */
function Credentials({ username, password, onDone, extra }: { username: string; password: string; onDone(): void; extra?: string }) {
  return (
    <div className="stack">
      <Notice tone="ok">{extra ?? "Done."} Give these details to the person. The password cannot be shown again.</Notice>
      <dl className="credentials">
        <dt>Username</dt>
        <dd>{username}</dd>
        <dt>Password</dt>
        <dd>{password}</dd>
      </dl>
      <div className="row">
        <button className="primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function CreateUserModal({
  token,
  roles,
  defaultRole,
  onClose,
  onCreated,
}: {
  token: string;
  roles: Role[];
  defaultRole: Role;
  onClose(): void;
  onCreated(): void;
}) {
  const { api } = useServices();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(defaultRole);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = checkUsername(username) ?? checkPassword(password);
    if (problem) return setError(problem);
    void run(async () => {
      const { user } = await api.createUser(token, { username, password, displayName, role });
      setCreated({ username: user.username, password });
      onCreated();
    });
  };

  return (
    <Modal title={`Add ${roleName[role].toLowerCase()}`} onClose={onClose}>
      {created ? (
        <Credentials
          {...created}
          extra={`${roleName[role]} account created.`}
          onDone={() => {
            setCreated(null);
            setDisplayName("");
            setUsername("");
            setPassword("");
          }}
        />
      ) : (
        <form onSubmit={submit} className="stack">
          {roles.length > 1 && (
            <Field label="Role">
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {roleName[r]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Full name">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Username" hint="Letters, numbers, dot, dash or underscore. Lowercase.">
            <input value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoCapitalize="none" required />
          </Field>
          <PasswordField value={password} onChange={setPassword} />
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="row end">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              Create
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ResetPasswordModal({ token, user, onClose }: { token: string; user: User; onClose(): void }) {
  const { api } = useServices();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = checkPassword(password);
    if (problem) return setError(problem);
    void run(async () => {
      await api.resetPassword(token, user.id, password);
      setDone(true);
    });
  };

  return (
    <Modal title={`Reset password — ${user.displayName}`} onClose={onClose}>
      {done ? (
        <Credentials username={user.username} password={password} onDone={onClose} extra="Password changed." />
      ) : (
        <form onSubmit={submit} className="stack">
          <PasswordField value={password} onChange={setPassword} />
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="row end">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              Set password
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function StudentResultsModal({ token, user, onClose }: { token: string; user: User; onClose(): void }) {
  const { api } = useServices();
  const data = useAsync(() => api.userAttempts(token, user.id, { limit: 30 }), [user.id]);
  return (
    <Modal title={`${user.displayName} — results`} onClose={onClose} wide>
      {data.loading && !data.data && <Loading />}
      {data.error && <Notice tone="bad">{data.error}</Notice>}
      {data.data && (
        <div className="stack">
          <h3 className="section-title">Personal bests</h3>
          {data.data.bests.length === 0 ? (
            <Empty>No leaderboard results yet.</Empty>
          ) : (
            <table className="data">
              <tbody>
                {data.data.bests.map((b) => (
                  <tr key={b.board}>
                    <td>{boardLabel(b.board)}</td>
                    <td className="num strong">{Math.round(b.wpm)} WPM</td>
                    <td className="num">{Math.round(b.accuracy)}%</td>
                    <td>{formatDate(b.achievedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3 className="section-title">Recent tests</h3>
          {data.data.attempts.length === 0 ? (
            <Empty>No tests yet.</Empty>
          ) : (
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
                  {data.data.attempts.map((a) => (
                    <tr key={a.id}>
                      <td>{formatDateTime(a.submittedAt)}</td>
                      <td>{a.testTitle ?? boardLabel(a.board)}</td>
                      <td className="num strong">{Math.round(a.wpm)}</td>
                      <td className="num">{Math.round(a.accuracy)}%</td>
                      <td>{a.flagged && <Pill tone="warn">held</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * People list for teachers (students only) and admins (students, teachers or
 * admins). `roles` is what this screen may show and create.
 */
export function StaffUsers({ session, roles, title }: { session: Session; roles: Role[]; title: string }) {
  const { api } = useServices();
  const token = session.token!;
  const [role, setRole] = useState<Role>(roles[0]!);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState<
    { kind: "create" } | { kind: "reset"; user: User } | { kind: "results"; user: User } | null
  >(null);
  const toggle = useAction();

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(search);
      setPage(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const list = useAsync(
    () => api.listUsers(token, { role, q, limit: PAGE, offset: page * PAGE }),
    [token, role, q, page],
  );

  const users = list.data?.users ?? [];
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE));

  return (
    <main className="page">
      <div className="page-head">
        <h2>{title}</h2>
        <button className="primary" onClick={() => setModal({ kind: "create" })}>
          Add {roleName[role].toLowerCase()}
        </button>
      </div>

      <div className="filters-row">
        <input
          type="search"
          placeholder="Search name or username"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search"
        />
        {roles.length > 1 && (
          <label>
            Show
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
                setPage(0);
              }}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {roleName[r]}s
                </option>
              ))}
            </select>
          </label>
        )}
        {list.data && <span className="muted">{list.data.total} total</span>}
      </div>

      {list.loading && !list.data && <Loading />}
      {list.error && <Notice tone="bad">{list.error}</Notice>}
      {toggle.error && <Notice tone="bad">{toggle.error}</Notice>}
      {list.data && users.length === 0 && <Empty>{q ? "Nobody matches that search." : "Nobody here yet."}</Empty>}
      {users.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Status</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.disabled ? "dim" : undefined}>
                  <td>
                    {u.displayName}
                    {u.id === session.user.id && <span className="you"> you</span>}
                  </td>
                  <td>@{u.username}</td>
                  <td>{u.disabled ? <Pill tone="bad">Disabled</Pill> : <Pill tone="ok">Active</Pill>}</td>
                  <td>{formatDate(u.createdAt)}</td>
                  <td className="actions">
                    {u.role === "student" && <button onClick={() => setModal({ kind: "results", user: u })}>Results</button>}
                    <button onClick={() => setModal({ kind: "reset", user: u })}>Reset password</button>
                    {u.id !== session.user.id && (
                      <button
                        disabled={toggle.busy}
                        onClick={() =>
                          void toggle.run(async () => {
                            await api.updateUser(token, u.id, { disabled: !u.disabled });
                            await list.reload(true);
                          })
                        }
                      >
                        {u.disabled ? "Enable" : "Disable"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={pages} onPage={setPage} />

      {modal?.kind === "create" && (
        <CreateUserModal
          token={token}
          roles={roles}
          defaultRole={role}
          onClose={() => setModal(null)}
          onCreated={() => void list.reload(true)}
        />
      )}
      {modal?.kind === "reset" && <ResetPasswordModal token={token} user={modal.user} onClose={() => setModal(null)} />}
      {modal?.kind === "results" && <StudentResultsModal token={token} user={modal.user} onClose={() => setModal(null)} />}
    </main>
  );
}
