import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AccountBook,
  ApiError,
  AuthError,
  AuthService,
  Http,
  MemoryStore,
  ResultQueue,
  ServerApi,
  SessionStore,
  SyncManager,
  type ResultBody,
} from "@typing/client-core";
import { buildText, type LogEntry } from "@typing/engine";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createPgliteDb } from "./db";
import { migrate } from "./migrate";
import { ensureAdmin } from "./seed";

/**
 * The real client logic (login, offline accounts, queues, sync) talking to the
 * real server. Each `device()` is one computer with its own storage; the
 * `network` switches simulate the internet dropping.
 */

let app: Awaited<ReturnType<typeof buildApp>>;
let close: () => Promise<void>;

const network = { offline: false, loseNextResponses: 0 };

const fetchViaServer: typeof fetch = async (input, init) => {
  if (network.offline) throw new TypeError("fetch failed");
  const url = new URL(String(input));
  const res = await app.inject({
    method: init?.method as "GET" | "POST" | "PATCH",
    url: url.pathname + url.search,
    headers: init?.headers as Record<string, string>,
    payload: init?.body as string | undefined,
  });
  // The server did the work, but the answer never reaches the app.
  if (network.loseNextResponses > 0 && url.pathname === "/results") {
    network.loseNextResponses--;
    throw new TypeError("fetch failed");
  }
  return new Response(res.body, { status: res.statusCode, headers: { "content-type": "application/json" } });
};

function device() {
  const store = new MemoryStore();
  const api = new ServerApi(new Http({ baseUrl: () => "http://server.test", fetch: fetchViaServer }));
  const accounts = new AccountBook(store);
  const sessions = new SessionStore(store);
  const queue = new ResultQueue(store);
  const sync = new SyncManager({ api, accounts, queue });
  const auth = new AuthService({ api, accounts, sessions, queue, sync });
  return { store, api, accounts, sessions, queue, sync, auth };
}

let counter = 0;
const uniq = (p: string) => `${p}${++counter}x`;

function typeLog(text: string, cps: number, ms = 10_000): LogEntry[] {
  const log: LogEntry[] = [];
  let seed = 4242;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let t = 0;
  for (const c of Array.from(text)) {
    if (t >= ms) break;
    log.push({ t: Math.round(t), c });
    t += 1000 / cps + (rand() - 0.5) * 120;
  }
  return log;
}

function practiceResult(cps = 6): ResultBody {
  const text = buildText("en", 400);
  return {
    clientId: crypto.randomUUID(),
    language: "en",
    level: 1000,
    mode: "time",
    value: 10,
    punctuation: false,
    numbers: false,
    text,
    log: typeLog(text, cps),
    completedAt: new Date().toISOString(),
  };
}

let admin: ReturnType<typeof device>;
let adminToken: string;

beforeAll(async () => {
  const db = await createPgliteDb();
  await migrate(db);
  const config = { ...loadConfig({}), adminUsername: "boss", adminPassword: "boss-password" };
  await ensureAdmin(db, config);
  app = await buildApp({ db, config });
  close = async () => {
    await app.close();
    await db.close();
  };
  admin = device();
  adminToken = (await admin.auth.login("boss", "boss-password")).token!;
}, 60_000);

afterAll(async () => close());

const attemptsOf = async (userId: string) => (await admin.api.userAttempts(adminToken, userId)).attempts;

describe("login and sign-up, online", () => {
  it("signs a student up and logs them in, and remembers them for later", async () => {
    const d = device();
    const name = uniq("online");
    const s = await d.auth.register({ username: name, displayName: "Online Kid", password: "secret1" });
    expect(s.token).toBeTruthy();
    expect(s.user).toMatchObject({ username: name, role: "student" });
    expect((await d.accounts.get(s.user.id))?.sync).toBe("synced");
    expect((await d.auth.restore())?.user.id).toBe(s.user.id);
    await d.auth.logout();
    expect(await d.auth.restore()).toBeNull();
    const again = await d.auth.login(name.toUpperCase(), "secret1");
    expect(again.user.id).toBe(s.user.id);
  });

  it("starts a login's time over for a test that ran long, with a new token", async () => {
    const d = device();
    const s = await d.auth.register({ username: uniq("renew"), displayName: "R", password: "secret1" });
    const next = await d.auth.renew(s);
    expect(next?.user.id).toBe(s.user.id);
    expect(next?.token).toBeTruthy();
    expect(next!.expiresAt!).toBeGreaterThanOrEqual(s.expiresAt!);
    expect((await d.auth.restore())?.expiresAt).toBe(next!.expiresAt);
  });

  it("explains the common mistakes", async () => {
    const d = device();
    const name = uniq("mistakes");
    await d.auth.register({ username: name, displayName: "M", password: "secret1" });
    await expect(d.auth.login(name, "wrong-pass")).rejects.toMatchObject({ code: "bad_credentials" });
    await expect(d.auth.login("nobody-here", "secret1")).rejects.toMatchObject({ code: "bad_credentials" });
    await expect(d.auth.login("", "")).rejects.toMatchObject({ code: "invalid" });
    await expect(d.auth.register({ username: name, displayName: "M", password: "secret1" })).rejects.toMatchObject({
      code: "username_taken",
    });
    await expect(d.auth.register({ username: "x", displayName: "M", password: "secret1" })).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("stops a disabled student, even one with this computer's saved copy", async () => {
    const d = device();
    const name = uniq("disabled");
    const s = await d.auth.register({ username: name, displayName: "D", password: "secret1" });
    await admin.api.updateUser(adminToken, s.user.id, { disabled: true });
    await expect(d.auth.login(name, "secret1")).rejects.toMatchObject({ code: "account_disabled" });
  });

  it("does not let an old saved password in once the server has a new one", async () => {
    const d = device();
    const name = uniq("reset");
    const s = await d.auth.register({ username: name, displayName: "R", password: "old-password" });
    await admin.api.resetPassword(adminToken, s.user.id, "new-password");
    // The server is reachable and says no: the saved copy on this computer must not override it.
    await expect(d.auth.login(name, "old-password")).rejects.toMatchObject({ code: "bad_credentials" });
    const ok = await d.auth.login(name, "new-password");
    expect(ok.token).toBeTruthy();
    // And the saved copy is refreshed for offline use.
    network.offline = true;
    try {
      await expect(d.auth.login(name, "old-password")).rejects.toBeInstanceOf(AuthError);
      expect((await d.auth.login(name, "new-password")).token).toBeUndefined();
    } finally {
      network.offline = false;
    }
  });

  it("only lets teachers and admins in when the server can be reached", async () => {
    const t = device();
    const name = uniq("teacher");
    await admin.api.createUser(adminToken, { username: name, password: "teachpass", displayName: "T", role: "teacher" });
    expect((await t.auth.login(name, "teachpass")).user.role).toBe("teacher");
    await t.auth.logout();
    network.offline = true;
    try {
      await expect(t.auth.login(name, "teachpass")).rejects.toMatchObject({ code: "offline_unknown" });
    } finally {
      network.offline = false;
    }
  });
});

describe("working offline", () => {
  it("lets a student sign up and practise offline, then everything arrives when they are online", async () => {
    const d = device();
    const name = uniq("offline");

    network.offline = true;
    const s = await d.auth.register({ username: name, displayName: "Offline Kid", password: "secret1" });
    expect(s.token).toBeUndefined();
    expect((await d.accounts.get(s.user.id))?.sync).toBe("pending");

    const r1 = practiceResult(5);
    const r2 = practiceResult(7);
    await d.queue.enqueue(s.user.id, r1);
    await d.queue.enqueue(s.user.id, r2);
    await d.sync.run({ userId: s.user.id });
    expect(d.sync.online).toBe(false);
    expect(await d.queue.count(s.user.id)).toBe(2);

    // Back online: the account uploads on its own...
    network.offline = false;
    await d.sync.run({ userId: s.user.id });
    expect((await d.accounts.get(s.user.id))?.sync).toBe("synced");
    // ...and so do the results, with the key the account went up with: no password needed.
    expect(await d.queue.count(s.user.id)).toBe(0);

    const login = await d.auth.login(name, "secret1");
    expect(login.user.id).toBe(s.user.id); // the id chosen offline is the server's id

    const attempts = await attemptsOf(s.user.id);
    expect(attempts).toHaveLength(2);
    expect(attempts.every((a) => a.verified && !a.flagged)).toBe(true);
    const board = await d.api.leaderboard(login.token!, { language: "en", level: 1000, mode: "time", value: 10, period: "all", limit: 200 });
    expect(board.entries.some((e) => e.username === name)).toBe(true);
  });

  it("signs the student in by itself when the connection returns, so results upload without a password prompt", async () => {
    const d = device();
    const name = uniq("auto");

    network.offline = true;
    const s = await d.auth.register({ username: name, displayName: "Auto Kid", password: "secret1" });
    await d.queue.enqueue(s.user.id, practiceResult(5));
    expect(d.auth.canUpgrade(s.user.id)).toBe(true);
    expect(await d.auth.upgrade(s)).toBeNull(); // still offline

    network.offline = false;
    expect(await d.auth.upgrade(s)).toBeNull(); // the account is not on the server yet
    await d.sync.run({ userId: s.user.id }); // the regular sync uploads it
    const next = await d.auth.upgrade(s);
    expect(next?.token).toBeTruthy();
    expect(d.auth.canUpgrade(s.user.id)).toBe(false);
    await d.sync.run({ userId: s.user.id, token: next!.token }, { ignoreBackoff: true });
    expect(await d.queue.count(s.user.id)).toBe(0);
    expect(await attemptsOf(s.user.id)).toHaveLength(1);
  });

  /** The app closed and opened again on the same computer: same storage, nothing in memory. */
  const restart = (d: ReturnType<typeof device>) => {
    const api = d.api;
    const accounts = new AccountBook(d.store);
    const queue = new ResultQueue(d.store);
    const sync = new SyncManager({ api, accounts, queue });
    return { api, accounts, queue, sync, auth: new AuthService({ api, accounts, sessions: new SessionStore(d.store), queue, sync }) };
  };

  it("uploads after the app is restarted, with no password and no login", async () => {
    const d = device();
    const name = uniq("restart");

    network.offline = true;
    const s = await d.auth.register({ username: name, displayName: "Restart Kid", password: "secret1" });
    await d.queue.enqueue(s.user.id, practiceResult(5));
    network.offline = false;
    await d.sync.run({ userId: s.user.id }); // the account goes up with this computer's key
    expect(await d.accounts.uploadKey(s.user.id)).toBeTruthy();

    const again = restart(d);
    expect(again.auth.canUpgrade(s.user.id)).toBe(false); // the password is gone from memory
    await again.sync.run({ userId: s.user.id }, { ignoreBackoff: true }); // tokenless, like a restored session
    expect(await again.queue.count(s.user.id)).toBe(0);
    expect(await attemptsOf(s.user.id)).toHaveLength(1);
    expect((await again.sync.snapshot(s.user.id)).canUpload).toBe(true);
  });

  it("logging in online gives the computer its key, which keeps working after the login token is gone", async () => {
    const d = device();
    const name = uniq("online");
    const s = await d.auth.register({ username: name, displayName: "Online Kid", password: "secret1" });
    expect(await d.accounts.uploadKey(s.user.id)).toBeTruthy();

    await d.queue.enqueue(s.user.id, practiceResult(5));
    await d.sync.run({ userId: s.user.id }, { ignoreBackoff: true }); // no token passed: the key does it
    expect(await d.queue.count(s.user.id)).toBe(0);
  });

  it("an account from before keys existed gets one at its next login", async () => {
    const d = device();
    const name = uniq("legacy");
    const s = await d.auth.register({ username: name, displayName: "Old Kid", password: "secret1" });
    const a = (await d.accounts.get(s.user.id))!;
    await d.store.set(`account:${s.user.id}`, { ...a, deviceKey: undefined, deviceKeyOk: undefined });
    expect(await d.accounts.uploadKey(s.user.id)).toBeUndefined();

    await d.auth.login(name, "secret1");
    expect(await d.accounts.uploadKey(s.user.id)).toBeTruthy();
  });

  it("a password reset by a teacher stops the old key; the student's own login still works", async () => {
    const d = device();
    const name = uniq("reset");
    const s = await d.auth.register({ username: name, displayName: "Reset Kid", password: "secret1" });
    await admin.api.resetPassword(adminToken, s.user.id, "brandnew1");

    await d.queue.enqueue(s.user.id, practiceResult(5));
    await d.sync.run({ userId: s.user.id }, { ignoreBackoff: true });
    expect(await d.queue.count(s.user.id)).toBe(1); // refused
    expect(d.sync.needsLogin).toBe(true);
    expect(await d.accounts.uploadKey(s.user.id)).toBeUndefined();

    const login = await d.auth.login(name, "brandnew1"); // a new login brings a new key registration
    await d.sync.run({ userId: s.user.id, token: login.token }, { ignoreBackoff: true });
    expect(await d.queue.count(s.user.id)).toBe(0);
  });

  it("does not keep the password after logout", async () => {
    const d = device();
    network.offline = true;
    const s = await d.auth.register({ username: uniq("bye"), displayName: "Bye Kid", password: "secret1" });
    await d.auth.logout();
    network.offline = false;
    expect(d.auth.canUpgrade(s.user.id)).toBe(false);
    expect(await d.auth.upgrade(s)).toBeNull();
  });

  it("logs a student in offline with the account saved on this computer", async () => {
    const d = device();
    const name = uniq("returning");
    await d.auth.register({ username: name, displayName: "Returning", password: "secret1" });
    await d.auth.logout();

    network.offline = true;
    try {
      const s = await d.auth.login(name, "secret1");
      expect(s.token).toBeUndefined();
      expect(s.user.displayName).toBe("Returning");
      await expect(d.auth.login(name, "wrong-pass")).rejects.toMatchObject({ code: "offline_unknown" });
      await expect(d.auth.login("someone-new", "secret1")).rejects.toMatchObject({ code: "offline_unknown" });
    } finally {
      network.offline = false;
    }
  });

  it("asks for a new username when two computers picked the same one offline", async () => {
    const a = device();
    const b = device();
    const name = uniq("popular");

    network.offline = true;
    const sa = await a.auth.register({ username: name, displayName: "Asha", password: "secret1" });
    const sb = await b.auth.register({ username: name, displayName: "Bala", password: "secret2" });
    network.offline = false;

    await a.sync.run(null);
    await b.sync.run(null);
    expect((await a.accounts.get(sa.user.id))?.sync).toBe("synced");
    const conflict = await b.accounts.get(sb.user.id);
    expect(conflict?.sync).toBe("conflict");
    expect((await b.sync.snapshot()).conflicts).toHaveLength(1);

    // Bala keeps working offline-style on the conflicting name until they pick a new one.
    await expect(b.auth.renameConflict(sb.user.id, name)).rejects.toMatchObject({ code: "username_taken" });
    await expect(b.auth.renameConflict(sb.user.id, "no good!")).rejects.toMatchObject({ code: "invalid" });
    const renamed = await b.auth.renameConflict(sb.user.id, `${name}b`);
    expect(renamed).toMatchObject({ username: `${name}b`, sync: "synced" });

    // Bala's own password and id now work against the server.
    const login = await b.auth.login(`${name}b`, "secret2");
    expect(login.user.id).toBe(sb.user.id);
    // And Asha is unaffected.
    expect((await a.auth.login(name, "secret1")).user.id).toBe(sa.user.id);
  });

  it("falls back to the local copy for an account the server has never accepted", async () => {
    const d = device();
    const name = uniq("neverseen");
    network.offline = true;
    const s = await d.auth.register({ username: name, displayName: "N", password: "secret1" });
    network.offline = false;
    // Online, but the server has not been told about this account yet and login is attempted first:
    // syncing happens first, so it works against the server (the id is the same).
    const login = await d.auth.login(name, "secret1");
    expect(login.token).toBeTruthy();
    expect(login.user.id).toBe(s.user.id);
  });
});

describe("the results queue", () => {
  const registered = async () => {
    const d = device();
    const name = uniq("queue");
    const s = await d.auth.register({ username: name, displayName: "Q", password: "secret1" });
    return { d, name, s };
  };

  it("does not count a result twice when the answer was lost on the way back", async () => {
    const { d, s } = await registered();
    const r = practiceResult();
    await d.queue.enqueue(s.user.id, r);

    network.loseNextResponses = 1; // the server saves it, the app never hears
    const first = await d.sync.flushResults({ userId: s.user.id, token: s.token }, { ignoreBackoff: true });
    expect(first?.stopped).toBe("unreachable");
    expect(await d.queue.count(s.user.id)).toBe(1);
    expect(await attemptsOf(s.user.id)).toHaveLength(1);

    const second = await d.sync.flushResults({ userId: s.user.id, token: s.token }, { ignoreBackoff: true });
    expect(second).toMatchObject({ sent: 1, remaining: 0 });
    expect(await attemptsOf(s.user.id)).toHaveLength(1);
  });

  it("keeps results when the login is refused, and asks the student to log in again", async () => {
    const { d, s } = await registered();
    await d.queue.enqueue(s.user.id, practiceResult());
    await d.accounts.setDeviceKeyOk(s.user.id, false); // no key: only the (bad) login token is left to try
    const report = await d.sync.flushResults({ userId: s.user.id, token: "not-a-real-token" });
    expect(report?.stopped).toBe("auth");
    expect(d.sync.needsLogin).toBe(true);
    expect(await d.queue.count(s.user.id)).toBe(1);
    // Logging in again fixes it.
    const again = await d.auth.login(s.user.username, "secret1");
    await d.sync.run({ userId: s.user.id, token: again.token }, { ignoreBackoff: true });
    expect(await d.queue.count(s.user.id)).toBe(0);
    expect(d.sync.needsLogin).toBe(false);
  });

  it("sets aside a result the server will never accept, without blocking the rest", async () => {
    const { d, s } = await registered();
    const bad = { ...practiceResult(), mode: "words" as const, value: 99 }; // word count does not match the text
    await d.queue.enqueue(s.user.id, bad);
    await d.queue.enqueue(s.user.id, practiceResult());
    const report = await d.sync.flushResults({ userId: s.user.id, token: s.token }, { ignoreBackoff: true });
    expect(report).toMatchObject({ sent: 1, rejected: 1, remaining: 0 });
    expect((await d.queue.rejected(s.user.id))[0]?.reason).toMatch(/word/i);
    expect(await attemptsOf(s.user.id)).toHaveLength(1);
  });

  it("credits an upload to whoever's login sent it, whatever the queue says", async () => {
    const one = await registered();
    const two = await registered();
    await one.d.queue.enqueue(one.s.user.id, practiceResult());
    // Student two's login cannot upload student one's results (the server credits the logged-in student).
    await two.d.queue.enqueue(one.s.user.id, practiceResult());
    await two.d.sync.flushResults({ userId: one.s.user.id, token: two.s.token });
    expect(await attemptsOf(one.s.user.id)).toHaveLength(0);
    expect(await attemptsOf(two.s.user.id)).toHaveLength(1); // credited to whoever's token was used
  });
});

describe("hosted tests through the client", () => {
  it("lets a teacher host a test and a student take it, with the leaderboard", async () => {
    const t = device();
    const tname = uniq("teach");
    await admin.api.createUser(adminToken, { username: tname, password: "teachpass", displayName: "T", role: "teacher" });
    const teacher = await t.auth.login(tname, "teachpass");

    const now = Date.now();
    const { test } = await t.api.createTest(teacher.token!, {
      title: "Client test",
      language: "en",
      level: 200,
      durationSeconds: 10,
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
      maxAttempts: 2,
    });
    expect(test.status).toBe("active");

    const s = device();
    const student = await s.auth.register({ username: uniq("kid"), displayName: "Kid", password: "secret1" });
    const listed = (await s.api.listTests(student.token!)).tests.find((x) => x.id === test.id)!;
    expect(listed.text).toBeUndefined();

    const started = await s.api.startAttempt(student.token!, test.id);
    const submitted = await s.api.submitAttempt(student.token!, started.attemptId, typeLog(started.text, 6));
    expect(submitted.rank).toBe(1);
    const board = await s.api.testLeaderboard(student.token!, test.id);
    expect(board.entries[0]?.userId).toBe(student.user.id);

    await expect(s.api.createTest(student.token!, { title: "x", language: "en", level: 200, durationSeconds: 10, startsAt: "", endsAt: "" })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
