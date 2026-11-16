import { useState, type FormEvent } from "react";
import type { Session, SyncSnapshot } from "@typing/client-core";
import { useServices } from "./services";
import { Notice, useAction } from "./ui";

/** The server already has a different student with this username. They pick another. */
export function RenameBanner({
  session,
  onSession,
  refresh,
}: {
  session: Session;
  onSession(s: Session): void;
  refresh(): Promise<void>;
}) {
  const { auth } = useServices();
  const [name, setName] = useState("");
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const account = await auth.renameConflict(session.user.id, name);
      onSession({ ...session, user: { ...session.user, username: account.username } });
      await refresh();
    }).catch(() => undefined);
  };

  return (
    <Notice tone="warn">
      <form onSubmit={submit} className="inline-form">
        <span>
          The username <strong>@{session.user.username}</strong> is already used by someone else, so your account could
          not be saved online yet. Choose a different username:
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="new username" spellCheck={false} autoCapitalize="none" required aria-label="New username" />
        <button className="primary" type="submit" disabled={busy}>
          Save
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </Notice>
  );
}

/**
 * Results made offline can only be uploaded with the student's own login, and
 * the password is the only thing that gives one. Ask for it again, once.
 */
export function ReloginBanner({
  session,
  snapshot,
  onSession,
}: {
  session: Session;
  snapshot: SyncSnapshot;
  onSession(s: Session): void;
}) {
  const { auth } = useServices();
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const next = await auth.login(session.user.username, password);
      setPassword("");
      onSession(next);
    }).catch(() => undefined);
  };

  const n = snapshot.pendingResults;
  return (
    <Notice tone="info">
      <form onSubmit={submit} className="inline-form">
        <span>
          {n} result{n === 1 ? " is" : "s are"} waiting to be uploaded. Enter your password to send {n === 1 ? "it" : "them"}:
        </span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" autoComplete="current-password" required aria-label="Password" />
        <button className="primary" type="submit" disabled={busy}>
          Upload
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
    </Notice>
  );
}
