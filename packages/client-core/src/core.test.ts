import { describe, expect, it, vi } from "vitest";
import {
  AccountBook,
  ApiError,
  MemoryStore,
  NetworkError,
  PracticeHistory,
  ResultQueue,
  SessionStore,
  SyncManager,
  checkPassword,
  checkUsername,
  retryDelayMs,
  tokenExpiry,
  type ResultBody,
  type ServerApi,
  type User,
} from "./index";

const body = (clientId: string): ResultBody => ({
  clientId,
  language: "en",
  level: 1000,
  mode: "time",
  value: 60,
  punctuation: false,
  numbers: false,
  text: "the quick brown fox",
  log: [{ t: 0, c: "t" }],
});

/** A controllable clock. */
const clock = (start = 1_000_000) => {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

const jwt = (exp: number) =>
  `h.${btoa(JSON.stringify({ exp })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;

const user = (over: Partial<User> = {}): User => ({
  id: crypto.randomUUID(),
  username: "asha",
  displayName: "Asha",
  role: "student",
  disabled: false,
  createdAt: new Date().toISOString(),
  ...over,
});

describe("MemoryStore", () => {
  it("stores copies, lists keys by prefix in order, and deletes", async () => {
    const s = new MemoryStore();
    const value = { a: [1] };
    await s.set("x:2", value);
    await s.set("x:1", 1);
    await s.set("y:1", 1);
    value.a.push(2);
    expect(await s.get("x:2")).toEqual({ a: [1] });
    expect(await s.keys("x:")).toEqual(["x:1", "x:2"]);
    await s.delete("x:1");
    expect(await s.get("x:1")).toBeUndefined();
  });
});

describe("validation", () => {
  it("accepts what the server accepts and rejects the rest", () => {
    expect(checkUsername("Asha.K-9")).toBeNull();
    expect(checkUsername("  asha  ")).toBeNull();
    expect(checkUsername("a b")).not.toBeNull();
    expect(checkUsername("ab")).not.toBeNull();
    expect(checkPassword("123456")).toBeNull();
    expect(checkPassword("12345")).not.toBeNull();
  });
});

describe("AccountBook (accounts on this computer)", () => {
  it("creates an offline account that verifies with its password only", async () => {
    const book = new AccountBook(new MemoryStore());
    const a = await book.createOffline({ username: " Asha ", displayName: " Asha K ", password: "secret1" });
    expect(a).toMatchObject({ username: "asha", displayName: "Asha K", sync: "pending" });
    expect(a.passwordHash).not.toContain("secret1");
    expect((await book.verify("ASHA", "secret1"))?.id).toBe(a.id);
    expect(await book.verify("asha", "wrong-pass")).toBeNull();
    expect(await book.verify("nobody", "secret1")).toBeNull();
  });

  it("refuses bad input and a username already used on this computer", async () => {
    const book = new AccountBook(new MemoryStore());
    await book.createOffline({ username: "asha", displayName: "A", password: "secret1" });
    await expect(book.createOffline({ username: "ASHA", displayName: "B", password: "secret1" })).rejects.toThrow(
      /already used/,
    );
    await expect(book.createOffline({ username: "a", displayName: "B", password: "secret1" })).rejects.toThrow();
    await expect(book.createOffline({ username: "bobby", displayName: "", password: "secret1" })).rejects.toThrow();
    await expect(book.createOffline({ username: "bobby", displayName: "B", password: "123" })).rejects.toThrow();
  });

  it("remembers a server account so it can log in offline later", async () => {
    const book = new AccountBook(new MemoryStore());
    const u = user();
    await book.remember(u, "hunter22");
    const found = await book.verify("asha", "hunter22");
    expect(found).toMatchObject({ id: u.id, sync: "synced" });
  });

  it("refreshes the saved password when the server account is remembered again", async () => {
    const book = new AccountBook(new MemoryStore());
    const u = user();
    await book.remember(u, "old-password");
    await book.remember(u, "new-password");
    expect(await book.verify("asha", "old-password")).toBeNull();
    expect(await book.verify("asha", "new-password")).not.toBeNull();
  });

  it("flags an offline account as a conflict when the server's account has its name", async () => {
    const book = new AccountBook(new MemoryStore());
    const mine = await book.createOffline({ username: "asha", displayName: "Me", password: "secret1" });
    await book.remember(user({ username: "asha" }), "someone-elses");
    expect((await book.get(mine.id))?.sync).toBe("conflict");
    expect((await book.conflicts()).map((a) => a.id)).toEqual([mine.id]);
  });

  it("lets two accounts share a name in conflict, picking the one whose password matches", async () => {
    const book = new AccountBook(new MemoryStore());
    const mine = await book.createOffline({ username: "asha", displayName: "Me", password: "secret1" });
    const server = user({ username: "asha" });
    await book.remember(server, "other-pass");
    expect((await book.verify("asha", "secret1"))?.id).toBe(mine.id);
    expect((await book.verify("asha", "other-pass"))?.id).toBe(server.id);
  });

  it("renames a conflicting account and queues it for upload again", async () => {
    const book = new AccountBook(new MemoryStore());
    const mine = await book.createOffline({ username: "asha", displayName: "Me", password: "secret1" });
    await book.setSync(mine.id, "conflict");
    const renamed = await book.rename(mine.id, "Asha.K");
    expect(renamed).toMatchObject({ username: "asha.k", sync: "pending", id: mine.id });
    expect((await book.verify("asha.k", "secret1"))?.id).toBe(mine.id);
    await expect(book.rename(mine.id, "no good")).rejects.toThrow();
    await book.createOffline({ username: "taken", displayName: "T", password: "secret1" });
    await expect(book.rename(mine.id, "taken")).rejects.toThrow(/already used/);
  });

  it("lists the most recently used account first", async () => {
    const c = clock();
    const book = new AccountBook(new MemoryStore(), c.now);
    const a = await book.createOffline({ username: "first", displayName: "1", password: "secret1" });
    c.advance(1000);
    const b = await book.createOffline({ username: "second", displayName: "2", password: "secret1" });
    expect((await book.list()).map((x) => x.id)).toEqual([b.id, a.id]);
    c.advance(1000);
    await book.verify("first", "secret1");
    expect((await book.list()).map((x) => x.id)).toEqual([a.id, b.id]);
  });
});

describe("PracticeHistory", () => {
  const entry = (n: number) => ({ id: `e${n}`, at: n, wpm: n, raw: n, accuracy: 95, consistency: 70, label: "time 60" });

  it("lists a student's tests newest first, and only that student's", async () => {
    const history = new PracticeHistory(new MemoryStore());
    await history.add("a", entry(1));
    await history.add("a", entry(3));
    await history.add("a", entry(2));
    await history.add("b", entry(9));
    expect((await history.list("a")).map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
    expect((await history.list("b")).map((e) => e.id)).toEqual(["e9"]);
  });

  it("keeps the latest 100", async () => {
    const history = new PracticeHistory(new MemoryStore());
    for (let i = 1; i <= 105; i++) await history.add("a", entry(i));
    const list = await history.list("a");
    expect(list).toHaveLength(100);
    expect(list[0]!.id).toBe("e105");
    expect(list.at(-1)!.id).toBe("e6");
  });
});

describe("SessionStore", () => {
  it("reads when a token expires", () => {
    expect(tokenExpiry(jwt(2_000_000))).toBe(2_000_000_000);
    expect(tokenExpiry("garbage")).toBeUndefined();
  });

  it("restores a session, and clears it", async () => {
    const s = new SessionStore(new MemoryStore());
    const u = user();
    await s.save({ user: u, token: jwt(9_999_999_999) });
    expect((await s.load())?.user.id).toBe(u.id);
    await s.clear();
    expect(await s.load()).toBeNull();
  });

  it("lets a student carry on offline when the token has expired, but ends a teacher's session", async () => {
    const c = clock(5_000_000);
    const s = new SessionStore(new MemoryStore(), c.now);
    const expired = jwt(1_000); // long ago
    await s.save({ user: user(), token: expired });
    const kept = await s.load();
    expect(kept?.user.role).toBe("student");
    expect(kept?.token).toBeUndefined();
    await s.save({ user: user({ role: "teacher" }), token: expired });
    expect(await s.load()).toBeNull();
  });

  it("ends every login one hour and five minutes after it began, offline or not", async () => {
    const c = clock(1_000_000);
    const s = new SessionStore(new MemoryStore(), c.now);
    await s.save({ user: user() }); // a student logged in offline: no token at all
    c.advance(65 * 60_000 - 1);
    expect(await s.load()).not.toBeNull();
    c.advance(1);
    expect(await s.load()).toBeNull();
  });

  it("keeps the original end time when a login is updated, and drops one saved without an end time", async () => {
    const c = clock(1_000_000);
    const store = new MemoryStore();
    const s = new SessionStore(store, c.now);
    const end = await s.save({ user: user() });
    c.advance(30 * 60_000);
    expect(await s.save({ user: user() }, end)).toBe(end);
    expect((await s.load())?.expiresAt).toBe(end);
    await store.set("session", { user: user() });
    expect(await s.load()).toBeNull();
  });
});

describe("ResultQueue", () => {
  const sender = (impl: (b: ResultBody) => unknown) => ({
    postResult: vi.fn(async (_t: string, b: ResultBody) => impl(b) as never),
  });

  it("keeps each student's results apart and uploads oldest first", async () => {
    const c = clock();
    const q = new ResultQueue(new MemoryStore(), c.now);
    await q.enqueue("u1", body("a"));
    c.advance(10);
    await q.enqueue("u2", body("x"));
    c.advance(10);
    await q.enqueue("u1", body("b"));
    expect(await q.count("u1")).toBe(2);
    expect(await q.count("u2")).toBe(1);

    const sent: string[] = [];
    const report = await q.flush(sender((b) => sent.push(b.clientId)), "u1", "token");
    expect(sent).toEqual(["a", "b"]);
    expect(report).toEqual({ sent: 2, rejected: 0, remaining: 0 });
    expect(await q.count("u2")).toBe(1); // untouched
  });

  it("keeps results and backs off when the server cannot be reached", async () => {
    const c = clock();
    const q = new ResultQueue(new MemoryStore(), c.now);
    await q.enqueue("u", body("a"));
    await q.enqueue("u", body("b"));
    const down = sender(() => {
      throw new NetworkError();
    });
    const first = await q.flush(down, "u", "t");
    expect(first).toMatchObject({ sent: 0, remaining: 2, stopped: "unreachable" });
    expect(down.postResult).toHaveBeenCalledTimes(1); // does not hammer the server item by item

    // Straight away: held back, no request at all.
    const waiting = await q.flush(down, "u", "t");
    expect(waiting.stopped).toBe("backoff");
    expect(down.postResult).toHaveBeenCalledTimes(1);

    // After the delay it tries again, and now succeeds.
    c.advance(retryDelayMs(1) + 1);
    const up = sender(() => ({ duplicate: false, records: [] }));
    expect(await q.flush(up, "u", "t")).toMatchObject({ sent: 2, remaining: 0 });
  });

  it("can skip the wait right after a login", async () => {
    const c = clock();
    const q = new ResultQueue(new MemoryStore(), c.now);
    await q.enqueue("u", body("a"));
    await q.flush(sender(() => { throw new NetworkError(); }), "u", "t");
    const ok = sender(() => ({ duplicate: false, records: [] }));
    expect((await q.flush(ok, "u", "t")).stopped).toBe("backoff");
    expect(await q.flush(ok, "u", "t", { ignoreBackoff: true })).toMatchObject({ sent: 1 });
    // resetBackoff is the same idea, applied to the stored items.
    await q.enqueue("u", body("b"));
    await q.flush(sender(() => { throw new NetworkError(); }), "u", "t");
    await q.resetBackoff("u");
    expect(await q.flush(ok, "u", "t")).toMatchObject({ sent: 1 });
  });

  it("treats a struggling server (5xx) like being offline", async () => {
    const q = new ResultQueue(new MemoryStore(), clock().now);
    await q.enqueue("u", body("a"));
    const r = await q.flush(sender(() => { throw new ApiError(503, "x", "waking up"); }), "u", "t");
    expect(r).toMatchObject({ stopped: "unreachable", remaining: 1 });
  });

  it("moves a result the server refuses for good out of the way and carries on", async () => {
    const q = new ResultQueue(new MemoryStore(), clock().now);
    await q.enqueue("u", body("bad"));
    await q.enqueue("u", body("good"));
    const sent: string[] = [];
    const r = await q.flush(
      sender((b) => {
        if (b.clientId === "bad") throw new ApiError(400, "invalid_result", "Not a valid result");
        sent.push(b.clientId);
        return { duplicate: false, records: [] };
      }),
      "u",
      "t",
    );
    expect(r).toEqual({ sent: 1, rejected: 1, remaining: 0 });
    expect(sent).toEqual(["good"]);
    const rejected = await q.rejected("u");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ id: "bad", reason: "Not a valid result" });
    await q.clearRejected("u");
    expect(await q.rejected("u")).toEqual([]);
  });

  it("stops and keeps everything when the login is no longer accepted", async () => {
    const q = new ResultQueue(new MemoryStore(), clock().now);
    await q.enqueue("u", body("a"));
    await q.enqueue("u", body("b"));
    const r = await q.flush(sender(() => { throw new ApiError(401, "unauthorized", "Please log in"); }), "u", "t");
    expect(r).toMatchObject({ stopped: "auth", sent: 0, remaining: 2 });
    // A disabled account is refused the same way.
    const d = await q.flush(sender(() => { throw new ApiError(403, "forbidden", "no"); }), "u", "t");
    expect(d.stopped).toBe("auth");
  });

  it("survives a result that is already on the server", async () => {
    const q = new ResultQueue(new MemoryStore(), clock().now);
    await q.enqueue("u", body("a"));
    const r = await q.flush(sender(() => ({ duplicate: true, records: [] })), "u", "t");
    expect(r).toMatchObject({ sent: 1, remaining: 0 });
  });

  it("waits longer each time, up to ten minutes", () => {
    expect([1, 2, 3, 4].map(retryDelayMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(retryDelayMs(50)).toBe(600_000);
  });
});

describe("SyncManager", () => {
  /** Just enough of the API for the sync manager. */
  const fakeApi = (opts: {
    up?: () => boolean;
    accounts?: (ids: string[]) => { id: string; status: "created" | "exists" | "username_taken" }[];
    results?: (b: ResultBody) => unknown;
  }) => {
    const probes = vi.fn();
    const api = {
      http: {
        request: vi.fn(async () => {
          probes();
          if (opts.up && !opts.up()) throw new NetworkError();
          return { ok: true };
        }),
      },
      syncAccounts: vi.fn(async (list: { id: string }[]) => {
        if (opts.up && !opts.up()) throw new NetworkError();
        return { results: (opts.accounts ?? ((ids) => ids.map((id) => ({ id, status: "created" as const }))))(list.map((a) => a.id)) };
      }),
      postResult: vi.fn(async (_t: string, b: ResultBody) => {
        if (opts.up && !opts.up()) throw new NetworkError();
        return (opts.results ?? (() => ({ duplicate: false, records: [] })))(b);
      }),
    };
    return { api: api as unknown as ServerApi, raw: api, probes };
  };

  const setup = (api: ServerApi) => {
    const store = new MemoryStore();
    const accounts = new AccountBook(store);
    const queue = new ResultQueue(store);
    return { accounts, queue, sync: new SyncManager({ api, accounts, queue }) };
  };

  it("uploads offline accounts and marks them synced, or in conflict when the name is taken", async () => {
    let takenId = "";
    const { api } = fakeApi({
      accounts: (ids) => ids.map((id) => ({ id, status: id === takenId ? ("username_taken" as const) : ("created" as const) })),
    });
    const { accounts, sync } = setup(api);
    const a = await accounts.createOffline({ username: "first", displayName: "1", password: "secret1" });
    const b = await accounts.createOffline({ username: "second", displayName: "2", password: "secret1" });
    takenId = b.id;
    expect(await sync.syncAccounts()).toBe(true);
    expect((await accounts.get(a.id))?.sync).toBe("synced");
    expect((await accounts.get(b.id))?.sync).toBe("conflict");
    const snap = await sync.snapshot();
    expect(snap).toMatchObject({ pendingAccounts: 0 });
    expect(snap.conflicts.map((c) => c.id)).toEqual([b.id]);
  });

  it("leaves accounts waiting and reports offline when the server is unreachable", async () => {
    const { api } = fakeApi({ up: () => false });
    const { accounts, sync } = setup(api);
    await accounts.createOffline({ username: "first", displayName: "1", password: "secret1" });
    expect(await sync.syncAccounts()).toBe(false);
    expect(sync.online).toBe(false);
    expect((await sync.snapshot()).pendingAccounts).toBe(1);
  });

  it("does nothing when offline, then uploads accounts and results once the server is back", async () => {
    let up = false;
    const { api, raw } = fakeApi({ up: () => up });
    const { accounts, queue, sync } = setup(api);
    await accounts.createOffline({ username: "first", displayName: "1", password: "secret1" });
    await queue.enqueue("u1", body("r1"));

    await sync.run({ userId: "u1", token: "t" });
    expect(sync.online).toBe(false);
    expect(raw.syncAccounts).not.toHaveBeenCalled();
    expect(raw.postResult).not.toHaveBeenCalled();
    expect(await queue.count("u1")).toBe(1);

    up = true;
    await sync.run({ userId: "u1", token: "t" });
    expect(sync.online).toBe(true);
    expect(raw.syncAccounts).toHaveBeenCalledTimes(1);
    expect(await queue.count("u1")).toBe(0);
  });

  it("only uploads accounts when there is no token (an offline login)", async () => {
    const { api, raw } = fakeApi({});
    const { queue, sync } = setup(api);
    await queue.enqueue("u1", body("r1"));
    await sync.run({ userId: "u1" });
    expect(raw.postResult).not.toHaveBeenCalled();
    expect(await queue.count("u1")).toBe(1);
  });

  it("shares one run between callers asking at the same time", async () => {
    const { api, probes } = fakeApi({});
    const { sync } = setup(api);
    await Promise.all([sync.run(null), sync.run(null), sync.run(null)]);
    expect(probes).toHaveBeenCalledTimes(1);
    await sync.run(null);
    expect(probes).toHaveBeenCalledTimes(2);
  });

  it("asks for a fresh login when uploads are refused as unauthorised", async () => {
    const { api } = fakeApi({
      results: () => {
        throw new ApiError(401, "unauthorized", "Please log in");
      },
    });
    const { queue, sync } = setup(api);
    await queue.enqueue("u1", body("r1"));
    await sync.run({ userId: "u1", token: "expired" });
    const snap = await sync.snapshot("u1");
    expect(snap).toMatchObject({ needsLogin: true, pendingResults: 1, online: true });
  });

  it("tells listeners when something changed", async () => {
    const { api } = fakeApi({});
    const { sync } = setup(api);
    const seen = vi.fn();
    const stop = sync.subscribe(seen);
    await sync.run(null);
    expect(seen).toHaveBeenCalled();
    stop();
    seen.mockClear();
    await sync.run(null);
    expect(seen).not.toHaveBeenCalled();
  });

  it("counts a server that answers with an error as online", async () => {
    const { api, raw } = fakeApi({});
    raw.http.request.mockRejectedValueOnce(new ApiError(404, "not_found", "no"));
    const { sync } = setup(api);
    expect(await sync.probe()).toBe(true);
    raw.http.request.mockRejectedValueOnce(new ApiError(503, "x", "waking up"));
    expect(await sync.probe()).toBe(false);
  });
});
