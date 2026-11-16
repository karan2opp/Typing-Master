import { useEffect, useRef, useState } from "react";
import { testActivity } from "./testActivity";
import type { Session } from "@typing/client-core";
import { Landing } from "./Landing";
import { LoginScreen } from "./LoginScreen";
import { Shell } from "./Shell";
import { ServicesProvider, useServices } from "./services";
import "@fontsource/roboto-mono/400.css";
import "./styles.css";
import "./app.css";

function Root({ platform, downloadUrl }: { platform: "web" | "desktop"; downloadUrl?: string }) {
  const { auth } = useServices();
  // undefined: still reading the saved session; null: nobody is logged in.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Whether the visitor has left the landing page (web only).
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    void auth.restore().then(setSession);
  }, [auth]);

  const logout = async () => {
    await auth.logout();
    window.location.hash = "";
    setSession(null);
  };

  const latest = useRef(session);
  latest.current = session;

  // Taking a test keeps the login alive: the moment a test starts (and again when it ends) the login's time
  // starts over from zero, so a long test never runs into the end of the login.
  useEffect(() => {
    let renewing = false;
    return testActivity.onChange(() => {
      const current = latest.current;
      if (!current || renewing) return;
      renewing = true;
      void auth
        .renew(current)
        .then((next) => {
          if (latest.current?.user.id !== current.user.id) return;
          return next ? setSession(next) : logout();
        })
        .finally(() => (renewing = false));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);

  // When the login runs out while the app is open, go back to the login screen, unless a test is in
  // progress: that test is not interrupted, and its start has already renewed the login (above).
  const expiresAt = session?.expiresAt;
  useEffect(() => {
    if (expiresAt === undefined) return;
    const timer = setTimeout(
      () => testActivity.isRunning() || void logout(),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt, auth]);

  if (session === undefined) return <div className="splash">Typing Master</div>;
  // The website opens on the landing page; the desktop app goes straight to login.
  if (!session && platform === "web" && !entered && downloadUrl) {
    return <Landing downloadUrl={downloadUrl} onStart={() => setEntered(true)} />;
  }
  if (!session) return <LoginScreen platform={platform} onSession={setSession} />;
  return <Shell platform={platform} session={session} onSession={setSession} onLogout={logout} />;
}

/**
 * The whole app: login, then the student, teacher or admin screens.
 * `defaultServerUrl` is where the server is unless this computer was told otherwise.
 */
export function App({
  platform,
  defaultServerUrl,
  downloadUrl,
}: {
  platform: "web" | "desktop";
  defaultServerUrl: string;
  /** Where the landing page's download button goes. */
  downloadUrl?: string;
}) {
  return (
    <ServicesProvider defaultServerUrl={defaultServerUrl}>
      <Root platform={platform} downloadUrl={downloadUrl} />
    </ServicesProvider>
  );
}
