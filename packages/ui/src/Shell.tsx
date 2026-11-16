import { useEffect, useRef, useState } from "react";
import type { ResultBody, Role, Session, SyncSnapshot } from "@typing/client-core";
import { PracticeApp } from "./PracticeApp";
import { TestsScreen } from "./TestsScreen";
import { LeaderboardScreen } from "./LeaderboardScreen";
import { ProfileScreen } from "./ProfileScreen";
import { StaffTests } from "./StaffTests";
import { StaffTestDetail } from "./StaffTestDetail";
import { StaffUsers } from "./StaffUsers";
import { RenameBanner, ReloginBanner } from "./Banners";
import { useServices, useSync } from "./services";
import { useRoute } from "./useRoute";
import { Pill } from "./ui";

interface NavItem {
  to: string;
  label: string;
}

const NAV: Record<Role, NavItem[]> = {
  student: [
    { to: "practice", label: "Practice" },
    { to: "tests", label: "Tests" },
    { to: "leaderboard", label: "Leaderboard" },
    { to: "profile", label: "Profile" },
  ],
  teacher: [
    { to: "staff/tests", label: "Tests" },
    { to: "staff/students", label: "Students" },
    { to: "leaderboard", label: "Leaderboard" },
  ],
  admin: [
    { to: "staff/tests", label: "Tests" },
    { to: "staff/students", label: "Students" },
    { to: "staff/people", label: "Teachers & admins" },
    { to: "leaderboard", label: "Leaderboard" },
  ],
};

function SyncPill({ snapshot, syncNow }: { snapshot: SyncSnapshot; syncNow(): Promise<void> }) {
  const waiting = snapshot.pendingResults + snapshot.pendingAccounts;
  const tone = snapshot.online === false ? "warn" : waiting > 0 ? "info" : "ok";
  const label =
    snapshot.online === false
      ? waiting
        ? `Offline · ${waiting} waiting`
        : "Offline"
      : waiting > 0
        ? `${waiting} waiting to upload`
        : snapshot.online
          ? "Online"
          : "Checking…";
  return (
    <button className={`syncpill ${tone}`} onClick={() => void syncNow()} title="Check the connection and upload anything waiting">
      <span aria-hidden="true">●</span> {label}
    </button>
  );
}

export function Shell({
  platform,
  session,
  onSession,
  onLogout,
}: {
  platform: "web" | "desktop";
  session: Session;
  onSession(s: Session): void;
  onLogout(): void;
}) {
  const role = session.user.role;
  const staff = role !== "student";
  const home = staff ? "staff/tests" : "practice";
  const [path, go] = useRoute(home);
  const { auth, queue, history: practiceHistory } = useServices();
  const { snapshot, refresh, syncNow } = useSync(session);
  const [typing, setTyping] = useState(false);

  const addResult = async (body: ResultBody) => {
    await queue.enqueue(session.user.id, body);
    await refresh();
    void syncNow();
  };

  // A route this role may not use goes home.
  const allowed = new Set(NAV[role].map((n) => n.to));
  const section = path.startsWith("staff/tests/") ? "staff/tests" : path;
  const route = allowed.has(section) ? path : home;

  // A student who logged in offline gets a real login by themselves as soon as the server is reachable.
  const upgrading = useRef(false);
  const [, rerender] = useState(0);
  useEffect(() => {
    if (staff || session.token || snapshot.online !== true || upgrading.current) return;
    upgrading.current = true;
    void auth
      .upgrade(session)
      .then((next) => (next ? onSession(next) : rerender((n) => n + 1)))
      .finally(() => void (upgrading.current = false));
    // `session` and `onSession` change identity without changing what this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, staff, session.token, session.user.id, auth]);

  const conflict = snapshot.conflicts.some((c) => c.id === session.user.id);
  // Only ask for the password when nothing else can upload: this computer has no upload key yet
  // (an account from before keys existed) and the app can't sign in by itself.
  const needsUpload =
    !staff &&
    snapshot.pendingResults > 0 &&
    !snapshot.canUpload &&
    (snapshot.needsLogin || (!session.token && snapshot.online === true)) &&
    !auth.canUpgrade(session.user.id);

  return (
    <div className="app">
      <header className={"top" + (typing ? " faded" : "")} inert={typing}>
        <h1>Typing Master</h1>
        <span className="badge">{platform === "desktop" ? "Desktop" : "Web"}</span>
        <nav className="nav" aria-label="Main">
          {NAV[role].map((n) => (
            <a key={n.to} href={`#/${n.to}`} className={section === n.to ? "on" : undefined} aria-current={section === n.to ? "page" : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <span className="grow" />
        <SyncPill snapshot={snapshot} syncNow={syncNow} />
        <span className="who">
          {session.user.displayName}
          {staff && <Pill tone="info">{role}</Pill>}
        </span>
        <button onClick={onLogout}>Log out</button>
      </header>

      {!staff && conflict && <RenameBanner session={session} onSession={onSession} refresh={refresh} />}
      {needsUpload && <ReloginBanner session={session} snapshot={snapshot} onSession={onSession} />}

      {route === "practice" && (
        <PracticeApp
          onResult={(r) => void addResult(r)}
          history={{
            list: () => practiceHistory.list(session.user.id),
            add: (entry) => practiceHistory.add(session.user.id, entry),
          }}
          onTypingChange={setTyping}
        />
      )}
      {route === "tests" && <TestsScreen session={session} />}
      {route === "leaderboard" && <LeaderboardScreen session={session} />}
      {route === "profile" && <ProfileScreen session={session} snapshot={snapshot} syncNow={syncNow} />}

      {route === "staff/tests" && <StaffTests session={session} open={(id) => go(`staff/tests/${id}`)} />}
      {route.startsWith("staff/tests/") && (
        <StaffTestDetail session={session} testId={route.slice("staff/tests/".length)} back={() => go("staff/tests")} />
      )}
      {route === "staff/students" && <StaffUsers key="students" session={session} roles={["student"]} title="Students" />}
      {route === "staff/people" && role === "admin" && (
        <StaffUsers key="people" session={session} roles={["teacher", "admin"]} title="Teachers & admins" />
      )}
    </div>
  );
}
