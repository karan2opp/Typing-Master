import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  AccountBook,
  AuthService,
  Http,
  PracticeHistory,
  ResultQueue,
  ServerApi,
  SessionStore,
  SyncManager,
  createIndexedDbStore,
  type KvStore,
  type Session,
  type SyncSnapshot,
} from "@typing/client-core";

export interface Services {
  store: KvStore;
  api: ServerApi;
  accounts: AccountBook;
  queue: ResultQueue;
  history: PracticeHistory;
  sessions: SessionStore;
  auth: AuthService;
  sync: SyncManager;
  /** Where the server is. Set once per computer from the login screen if the build default is wrong. */
  serverUrl: { get(): string; set(url: string): Promise<void> };
}

const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("useServices must be used inside <ServicesProvider>");
  return s;
}

const cleanUrl = (u: string) => u.trim().replace(/\/+$/, "");

export async function createServices(defaultServerUrl: string, store: KvStore = createIndexedDbStore()): Promise<Services> {
  let url = cleanUrl((await store.get<string>("serverUrl")) ?? defaultServerUrl);
  const api = new ServerApi(new Http({ baseUrl: () => url }));
  const accounts = new AccountBook(store);
  const sessions = new SessionStore(store);
  const queue = new ResultQueue(store);
  const sync = new SyncManager({ api, accounts, queue });
  const auth = new AuthService({ api, accounts, sessions, queue, sync });
  return {
    store,
    api,
    accounts,
    queue,
    history: new PracticeHistory(store),
    sessions,
    auth,
    sync,
    serverUrl: {
      get: () => url,
      set: async (next) => {
        url = cleanUrl(next);
        await store.set("serverUrl", url);
      },
    },
  };
}

export function ServicesProvider({
  defaultServerUrl,
  store,
  children,
}: {
  defaultServerUrl: string;
  store?: KvStore;
  children: ReactNode;
}) {
  const [services, setServices] = useState<Services | null>(null);
  useEffect(() => {
    let live = true;
    void createServices(defaultServerUrl, store).then((s) => live && setServices(s));
    return () => void (live = false);
  }, [defaultServerUrl, store]);
  if (!services) return <div className="splash">Typing Master</div>;
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

const EMPTY: SyncSnapshot = {
  pendingResults: 0,
  rejectedResults: 0,
  pendingAccounts: 0,
  conflicts: [],
  online: null,
  needsLogin: false,
  canUpload: false,
};

/**
 * Keeps the app in step with the server while it is open: checks on start,
 * every 30 seconds, and the moment the connection comes back.
 */
export function useSync(session: Session) {
  const { sync } = useServices();
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(EMPTY);
  const userId = session.user.role === "student" ? session.user.id : undefined;
  const token = session.token;

  const refresh = useCallback(async () => setSnapshot(await sync.snapshot(userId)), [sync, userId]);

  const syncNow = useCallback(async () => {
    await sync.run(userId ? { userId, token } : null, { ignoreBackoff: true });
    await refresh();
  }, [sync, userId, token, refresh]);

  useEffect(() => {
    void refresh();
    const stop = sync.subscribe(() => void refresh());
    void sync.run(userId ? { userId, token } : null);
    const timer = window.setInterval(() => void sync.run(userId ? { userId, token } : null), 30_000);
    const onOnline = () => void sync.run(userId ? { userId, token } : null, { ignoreBackoff: true });
    window.addEventListener("online", onOnline);
    return () => {
      stop();
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [sync, userId, token, refresh]);

  return { snapshot, refresh, syncNow };
}
