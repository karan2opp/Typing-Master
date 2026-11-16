import { useEffect, useState, type FormEvent } from "react";
import { AuthError, type Session } from "@typing/client-core";
import { useServices } from "./services";
import { Notice, useAction } from "./ui";

type Mode = "login" | "register";

export function LoginScreen({ platform, onSession }: { platform: "web" | "desktop"; onSession(s: Session): void }) {
  const { auth, sync } = useServices();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [online, setOnline] = useState<boolean | null>(null);
  const { busy, error, setError, run } = useAction();

  const check = () => sync.probe().then(setOnline);

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        const session =
          mode === "login"
            ? await auth.login(username, password)
            : await auth.register({ username, displayName, password });
        onSession(session);
      } catch (err) {
        setPassword("");
        throw err instanceof AuthError ? new Error(err.message) : err;
      }
    });
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Typing Master</h1>
        <p className="muted">{platform === "desktop" ? "Desktop app" : "Web app"}</p>

        <div className="tabs" role="tablist">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "tab on" : "tab"}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
            >
              {m === "login" ? "Log in" : "Create account"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="stack">
          {mode === "register" && (
            <label className="field-block">
              <span className="field-name">Your name</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" required />
            </label>
          )}
          <label className="field-block">
            <span className="field-name">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
            />
            {mode === "register" && <span className="field-hint">Letters, numbers, dot, dash or underscore.</span>}
          </label>
          <label className="field-block">
            <span className="field-name">Password</span>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
            {mode === "register" && <span className="field-hint">At least 6 characters.</span>}
          </label>

          {error && <Notice tone="bad">{error}</Notice>}

          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        <p className={"connection " + (online === false ? "off" : online ? "on" : "")}>
          {online === null
            ? "Checking connection…"
            : online
              ? "Connected"
              : mode === "register"
                ? "No connection. Your account will be saved on this computer and uploaded when you are online."
                : "No connection. You can log in with an account saved on this computer."}
        </p>
      </div>
    </div>
  );
}
