import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "./format";

/** Loads data when the screen opens (and again on `reload`), with the states every screen needs. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const counter = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async (quiet = false) => {
    const mine = ++counter.current;
    if (!quiet) setState((s) => ({ data: s.data, loading: true }));
    try {
      const data = await loadRef.current();
      if (mine === counter.current) setState({ data, loading: false });
    } catch (e) {
      if (mine === counter.current) setState((s) => ({ data: s.data, error: errorMessage(e), loading: false }));
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload };
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field-block">
      <span className="field-name">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export type Tone = "ok" | "warn" | "bad" | "muted" | "info";

export const Pill = ({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) => (
  <span className={`pill pill-${tone}`}>{children}</span>
);

export function Notice({
  tone = "info",
  children,
  action,
}: {
  tone?: Tone;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <div>{children}</div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage(p: number): void }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button onClick={() => onPage(0)} disabled={page === 0} aria-label="First page">
        «
      </button>
      <button onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
        ‹
      </button>
      <span>
        {page + 1} / {pages}
      </span>
      <button onClick={() => onPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page">
        ›
      </button>
      <button onClick={() => onPage(pages - 1)} disabled={page >= pages - 1} aria-label="Last page">
        »
      </button>
    </nav>
  );
}

/** Previous/next for lists whose total is not known. */
export function PrevNext({ page, hasMore, onPage }: { page: number; hasMore: boolean; onPage(p: number): void }) {
  if (page === 0 && !hasMore) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
        ‹ Newer
      </button>
      <span>Page {page + 1}</span>
      <button onClick={() => onPage(page + 1)} disabled={!hasMore} aria-label="Next page">
        Older ›
      </button>
    </nav>
  );
}

export const Loading = () => <p className="muted">Loading…</p>;

export const Empty = ({ children }: { children: ReactNode }) => <p className="muted empty">{children}</p>;

/** Runs an async action from a button, tracking busy state and the error to show. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
