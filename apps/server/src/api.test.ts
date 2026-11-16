import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TypingSession, buildText, hashPassword, wordsFor, type LogEntry } from "@typing/engine";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createPgliteDb } from "./db";
import { migrate } from "./migrate";
import { ensureAdmin } from "./seed";

// ---- Harness ---------------------------------------------------------------

let app: Awaited<ReturnType<typeof buildApp>>;
let close: () => Promise<void>;

beforeAll(async () => {
  const db = await createPgliteDb();
  await migrate(db);
  const config = { ...loadConfig({}), adminUsername: "admin", adminPassword: "admin-pass-1" };
  await ensureAdmin(db, config);
  app = await buildApp({ db, config });
  close = async () => {
    await app.close();
    await db.close();
  };
}, 60_000);

afterAll(async () => close());

type Res<T = any> = { status: number; body: T };

async function call(
  method: "GET" | "POST" | "PATCH",
  url: string,
  opts: { token?: string; deviceKey?: string; body?: unknown } = {},
): Promise<Res> {
  const res = await app.inject({
    method,
    url,
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.deviceKey ? { "x-device-key": opts.deviceKey } : {}),
    },
    payload: opts.body as object | undefined,
  });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}

let counter = 0;
const uniq = (prefix: string) => `${prefix}${++counter}`;

async function login(username: string, password: string): Promise<string> {
  const r = await call("POST", "/auth/login", { body: { username, password } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.token;
}

async function newStudent(name = uniq("student")) {
  const r = await call("POST", "/auth/register", { body: { username: name, password: "secret1", displayName: name } });
  expect(r.status).toBe(201);
  return { id: r.body.user.id as string, username: name, token: r.body.token as string };
}

let adminToken: string;
let teacherToken: string;
beforeAll(async () => {
  adminToken = await login("admin", "admin-pass-1");
  const t = await call("POST", "/users", {
    token: adminToken,
    body: { username: "teacher1", password: "teachpass", displayName: "Mrs Rao", role: "teacher" },
  });
  expect(t.status).toBe(201);
  teacherToken = await login("teacher1", "teachpass");
}, 60_000);

/** A human-looking keystroke log: types `text` at about `cps` characters a second with jitter. */
function typeLog(text: string, durationMs: number, cps: number, jitter = true): LogEntry[] {
  const log: LogEntry[] = [];
  let seed = 12345;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let t = 0;
  for (const c of Array.from(text)) {
    if (t >= durationMs) break;
    log.push({ t: Math.round(t), c });
    t += 1000 / cps + (jitter ? (rand() - 0.5) * 120 : 0);
  }
  return log;
}

const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const HOUR = 3_600_000;

// ---- Accounts and roles -----------------------------------------------------

describe("accounts and roles", () => {
  it("lets the seeded admin log in and rejects a wrong password", async () => {
    const bad = await call("POST", "/auth/login", { body: { username: "admin", password: "nope-nope" } });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("bad_credentials");
    const me = await call("GET", "/auth/me", { token: adminToken });
    expect(me.body.user).toMatchObject({ username: "admin", role: "admin" });
  });

  it("registers students with a lowercase username and refuses duplicates", async () => {
    const name = uniq("Mixed.Case");
    const first = await call("POST", "/auth/register", { body: { username: name, password: "secret1", displayName: "A" } });
    expect(first.status).toBe(201);
    expect(first.body.user.username).toBe(name.toLowerCase());
    expect(first.body.user.role).toBe("student");
    const again = await call("POST", "/auth/register", {
      body: { username: name.toUpperCase(), password: "secret1", displayName: "B" },
    });
    expect(again.status).toBe(409);
  });

  it("rejects short passwords and odd usernames", async () => {
    const r = await call("POST", "/auth/register", { body: { username: "a b", password: "123", displayName: "X" } });
    expect(r.status).toBe(400);
    expect(r.body.issues.map((i: any) => i.path).sort()).toEqual(["password", "username"]);
  });

  it("needs a login for protected routes", async () => {
    expect((await call("GET", "/users")).status).toBe(401);
    expect((await call("GET", "/leaderboards")).status).toBe(401);
    expect((await call("GET", "/users", { token: "garbage" })).status).toBe(401);
  });

  it("keeps students out of staff routes, and teachers out of admin powers", async () => {
    const s = await newStudent();
    expect((await call("GET", "/users", { token: s.token })).status).toBe(403);
    expect(
      (await call("POST", "/tests", { token: s.token, body: {} })).status,
    ).toBe(403);
    const makeTeacher = await call("POST", "/users", {
      token: teacherToken,
      body: { username: uniq("teacher"), password: "teachpass", displayName: "T", role: "teacher" },
    });
    expect(makeTeacher.status).toBe(403);
    const makeStudent = await call("POST", "/users", {
      token: teacherToken,
      body: { username: uniq("kid"), password: "secret1", displayName: "Kid" },
    });
    expect(makeStudent.status).toBe(201);
    expect(makeStudent.body.user.role).toBe("student");
  });

  it("shows teachers only students; admins see everyone", async () => {
    const asTeacher = await call("GET", "/users?limit=200", { token: teacherToken });
    expect(asTeacher.body.users.every((u: any) => u.role === "student")).toBe(true);
    const asAdmin = await call("GET", "/users?role=teacher", { token: adminToken });
    expect(asAdmin.body.users.map((u: any) => u.username)).toContain("teacher1");
    // A teacher asking for teachers still only gets students.
    const sneaky = await call("GET", "/users?role=admin", { token: teacherToken });
    expect(sneaky.body.users.every((u: any) => u.role === "student")).toBe(true);
  });

  it("stops a teacher managing another teacher or an admin", async () => {
    const admins = await call("GET", "/users?role=admin", { token: adminToken });
    const adminId = admins.body.users[0].id;
    expect((await call("PATCH", `/users/${adminId}`, { token: teacherToken, body: { disabled: true } })).status).toBe(403);
    expect(
      (await call("POST", `/users/${adminId}/reset-password`, { token: teacherToken, body: { newPassword: "hacked-it" } })).status,
    ).toBe(403);
    // And admins cannot lock themselves out.
    expect((await call("PATCH", `/users/${adminId}`, { token: adminToken, body: { disabled: true } })).status).toBe(400);
  });

  it("cuts a disabled account off immediately, even with a valid token", async () => {
    const s = await newStudent();
    expect((await call("GET", "/auth/me", { token: s.token })).status).toBe(200);
    expect((await call("PATCH", `/users/${s.id}`, { token: teacherToken, body: { disabled: true } })).status).toBe(200);
    expect((await call("GET", "/auth/me", { token: s.token })).status).toBe(401);
    const again = await call("POST", "/auth/login", { body: { username: s.username, password: "secret1" } });
    expect(again.status).toBe(403);
    await call("PATCH", `/users/${s.id}`, { token: adminToken, body: { disabled: false } });
    expect((await call("GET", "/auth/me", { token: s.token })).status).toBe(200);
  });

  it("hands a logged-in user a fresh token, and nobody else", async () => {
    const s = await newStudent();
    const fresh = await call("POST", "/auth/refresh", { token: s.token });
    expect(fresh.status).toBe(200);
    expect(fresh.body.user.id).toBe(s.id);
    expect((await call("GET", "/auth/me", { token: fresh.body.token })).status).toBe(200);
    expect((await call("POST", "/auth/refresh")).status).toBe(401);
    await call("PATCH", `/users/${s.id}`, { token: teacherToken, body: { disabled: true } });
    expect((await call("POST", "/auth/refresh", { token: s.token })).status).toBe(401);
    await call("PATCH", `/users/${s.id}`, { token: adminToken, body: { disabled: false } });
  });

  it("lets a teacher reset a forgotten password, and students change their own", async () => {
    const s = await newStudent();
    const reset = await call("POST", `/users/${s.id}/reset-password`, { token: teacherToken, body: { newPassword: "brand-new-1" } });
    expect(reset.status).toBe(200);
    expect((await call("POST", "/auth/login", { body: { username: s.username, password: "secret1" } })).status).toBe(401);
    const token = await login(s.username, "brand-new-1");
    const wrong = await call("POST", "/auth/change-password", { token, body: { currentPassword: "x-wrong", newPassword: "another-pass" } });
    expect(wrong.status).toBe(403);
    const ok = await call("POST", "/auth/change-password", { token, body: { currentPassword: "brand-new-1", newPassword: "another-pass" } });
    expect(ok.status).toBe(200);
    await login(s.username, "another-pass");
  });

  it("throttles repeated wrong passwords for one username", async () => {
    const s = await newStudent();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call("POST", "/auth/login", { body: { username: s.username, password: "wrong-wrong" } })).status);
    }
    expect(statuses.slice(0, 10).every((x) => x === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // Someone else in the same room is not locked out.
    const other = await newStudent();
    expect((await call("POST", "/auth/login", { body: { username: other.username, password: "secret1" } })).status).toBe(200);
  });
});

// ---- Accounts made offline ---------------------------------------------------

describe("offline account sync", () => {
  it("creates accounts from the device, is safe to repeat, and reports a taken name", async () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    const name = uniq("offline");
    const passwordHash = await hashPassword("device-pass");
    const first = await call("POST", "/sync/accounts", {
      body: { accounts: [{ id: id1, username: name, displayName: "Offline Kid", passwordHash }] },
    });
    expect(first.body.results).toEqual([{ id: id1, status: "created", deviceKey: false }]);

    const repeat = await call("POST", "/sync/accounts", {
      body: { accounts: [{ id: id1, username: name, displayName: "Offline Kid", passwordHash }] },
    });
    expect(repeat.body.results).toEqual([{ id: id1, status: "exists", deviceKey: false }]);

    // A different device picked the same name while offline.
    const clash = await call("POST", "/sync/accounts", {
      body: { accounts: [{ id: id2, username: name, displayName: "Other Kid", passwordHash }] },
    });
    expect(clash.body.results).toEqual([{ id: id2, status: "username_taken", deviceKey: false }]);

    // The uploaded account logs in online with the password chosen offline.
    const token = await login(name, "device-pass");
    const me = await call("GET", "/auth/me", { token });
    expect(me.body.user).toMatchObject({ id: id1, role: "student" });
  });

  it("rejects a malformed hash", async () => {
    const bad = await call("POST", "/sync/accounts", {
      body: { accounts: [{ id: crypto.randomUUID(), username: uniq("x"), displayName: "X", passwordHash: "plaintext" }] },
    });
    expect(bad.status).toBe(400);
  });

  it("cannot be used to make staff accounts", async () => {
    const name = uniq("boss");
    const sneaky = await call("POST", "/sync/accounts", {
      body: {
        accounts: [
          { id: crypto.randomUUID(), username: name, displayName: "Boss", passwordHash: await hashPassword("pw-pw-pw"), role: "admin" },
        ],
      },
    });
    expect(sneaky.body.results[0].status).toBe("created");
    const token = await login(name, "pw-pw-pw");
    expect((await call("GET", "/auth/me", { token })).body.user.role).toBe("student");
    expect((await call("GET", "/users", { token })).status).toBe(403);
  });
});

// ---- Device keys: uploading results without a login ----------------------------

describe("device keys", () => {
  const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const resultBody = () => {
    const text = buildText("en", 200);
    return { clientId: crypto.randomUUID(), language: "en", mode: "time", value: 10, text, log: typeLog(text, 10_000, 6) };
  };

  it("lets a registered key submit practice results, and nothing else", async () => {
    const s = await newStudent();
    const key = newKey();
    expect((await call("POST", "/auth/device-key", { token: s.token, body: { key } })).status).toBe(200);

    const ok = await call("POST", "/results", { deviceKey: `${s.id}.${key}`, body: resultBody() });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.verified).toBe(true);

    // It is not a login: nothing that reads data or acts as the student works.
    expect((await call("GET", "/auth/me", { deviceKey: `${s.id}.${key}` })).status).toBe(401);
    expect((await call("GET", `/users/${s.id}/attempts`, { deviceKey: `${s.id}.${key}` })).status).toBe(401);
    expect((await call("GET", "/tests", { deviceKey: `${s.id}.${key}` })).status).toBe(401);
  });

  it("refuses unknown keys, another student's id, and malformed values", async () => {
    const a = await newStudent();
    const b = await newStudent();
    const key = newKey();
    await call("POST", "/auth/device-key", { token: a.token, body: { key } });

    expect((await call("POST", "/results", { deviceKey: `${a.id}.${newKey()}`, body: resultBody() })).status).toBe(401);
    expect((await call("POST", "/results", { deviceKey: `${b.id}.${key}`, body: resultBody() })).status).toBe(401);
    expect((await call("POST", "/results", { deviceKey: "garbage", body: resultBody() })).status).toBe(401);
    expect((await call("POST", "/auth/device-key", { token: a.token, body: { key: "short" } })).status).toBe(400);
  });

  it("stops working when the student is disabled or a teacher resets the password", async () => {
    const a = await newStudent();
    const keyA = newKey();
    await call("POST", "/auth/device-key", { token: a.token, body: { key: keyA } });
    await call("PATCH", `/users/${a.id}`, { token: adminToken, body: { disabled: true } });
    expect((await call("POST", "/results", { deviceKey: `${a.id}.${keyA}`, body: resultBody() })).status).toBe(401);

    const b = await newStudent();
    const keyB = newKey();
    await call("POST", "/auth/device-key", { token: b.token, body: { key: keyB } });
    await call("POST", `/users/${b.id}/reset-password`, { token: teacherToken, body: { newPassword: "fresh-pass-1" } });
    expect((await call("POST", "/results", { deviceKey: `${b.id}.${keyB}`, body: resultBody() })).status).toBe(401);
  });

  it("is registered together with an offline account, but only when the sender holds the account", async () => {
    const id = crypto.randomUUID();
    const name = uniq("keyed");
    const passwordHash = await hashPassword("device-pass");
    const key = newKey();
    const first = await call("POST", "/sync/accounts", {
      body: { accounts: [{ id, username: name, displayName: "Keyed", passwordHash, deviceKey: key }] },
    });
    expect(first.body.results[0]).toEqual({ id, status: "created", deviceKey: true });
    expect((await call("POST", "/results", { deviceKey: `${id}.${key}`, body: resultBody() })).status).toBe(201);

    // Someone who knows the id and username but not the password hash cannot add a key.
    const thief = newKey();
    const attempt = await call("POST", "/sync/accounts", {
      body: {
        accounts: [{ id, username: name, displayName: "Keyed", passwordHash: await hashPassword("other"), deviceKey: thief }],
      },
    });
    expect(attempt.body.results[0]).toEqual({ id, status: "exists", deviceKey: false });
    expect((await call("POST", "/results", { deviceKey: `${id}.${thief}`, body: resultBody() })).status).toBe(401);

    // A retry from the real computer (same hash) is accepted.
    const retry = await call("POST", "/sync/accounts", {
      body: { accounts: [{ id, username: name, displayName: "Keyed", passwordHash, deviceKey: newKey() }] },
    });
    expect(retry.body.results[0]).toEqual({ id, status: "exists", deviceKey: true });
  });
});

// ---- Hosted tests --------------------------------------------------------------

describe("hosted tests", () => {
  const makeTest = async (overrides: Record<string, unknown> = {}) => {
    const r = await call("POST", "/tests", {
      token: teacherToken,
      body: {
        title: "Friday speed test",
        language: "en",
        durationSeconds: 10,
        startsAt: iso(-HOUR),
        endsAt: iso(HOUR),
        ...overrides,
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.test;
  };
  const start = (token: string, testId: string) => call("POST", `/tests/${testId}/attempts`, { token });
  const finish = async (token: string, testId: string, cps: number, jitter = true) => {
    const s = await start(token, testId);
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const log = typeLog(s.body.text, s.body.durationMs, cps, jitter);
    const r = await call("POST", `/attempts/${s.body.attemptId}/submit`, { token, body: { log } });
    return { start: s.body, submit: r };
  };

  it("gives students the test without its text, and teachers the text", async () => {
    const t = await makeTest();
    expect(t.status).toBe("active");
    expect(t.text.length).toBeGreaterThan(20);
    const s = await newStudent();
    const list = await call("GET", "/tests", { token: s.token });
    const mine = list.body.tests.find((x: any) => x.id === t.id);
    expect(mine).toBeDefined();
    expect("text" in mine).toBe(false);
    expect(mine).toMatchObject({ myAttempts: 0, myBestWpm: null, maxAttempts: 1 });
    const staff = await call("GET", `/tests/${t.id}`, { token: teacherToken });
    expect(staff.body.test.text).toBe(t.text);
    expect("text" in (await call("GET", `/tests/${t.id}`, { token: s.token })).body.test).toBe(false);
  });

  it("generates the passage from the chosen word level, and counts who took part", async () => {
    const easy = await makeTest({ level: 200, durationSeconds: 60 });
    const allowed = new Set(wordsFor("en", 200));
    expect(easy.text.split(" ").every((w: string) => allowed.has(w))).toBe(true);
    expect(easy.participants).toBe(0);
    const s = await newStudent();
    await finish(s.token, easy.id, 5);
    const again = await call("GET", `/tests/${easy.id}`, { token: teacherToken });
    expect(again.body.test.participants).toBe(1);
  });

  it("validates the window and a teacher's own passage", async () => {
    const backwards = await call("POST", "/tests", {
      token: teacherToken,
      body: { title: "x", language: "en", durationSeconds: 30, startsAt: iso(HOUR), endsAt: iso(-HOUR) },
    });
    expect(backwards.status).toBe(400);
    const accents = await call("POST", "/tests", {
      token: teacherToken,
      body: { title: "x", language: "en", durationSeconds: 30, startsAt: iso(0), endsAt: iso(HOUR), text: "café au lait is a very nice drink" },
    });
    expect(accents.status).toBe(400);
    expect(accents.body.message).toContain("é");
    const okHindi = await call("POST", "/tests", {
      token: teacherToken,
      body: { title: "हिंदी", language: "hi", durationSeconds: 30, startsAt: iso(0), endsAt: iso(HOUR), text: "भारत एक विशाल देश है जहाँ अनेक भाषाएँ बोली जाती हैं।" },
    });
    expect(okHindi.status).toBe(201);
    const latinInHindi = await call("POST", "/tests", {
      token: teacherToken,
      body: { title: "x", language: "hi", durationSeconds: 30, startsAt: iso(0), endsAt: iso(HOUR), text: "भारत एक विशाल देश है but not this part" },
    });
    expect(latinInHindi.status).toBe(400);
  });

  it("runs a test end to end: start, type, submit, rank", async () => {
    const t = await makeTest();
    const a = await newStudent();
    const b = await newStudent();
    const fast = await finish(a.token, t.id, 8);
    const slow = await finish(b.token, t.id, 4);
    expect(fast.submit.status, JSON.stringify(fast.submit.body)).toBe(200);
    expect(fast.submit.body.result.wpm).toBeGreaterThan(slow.submit.body.result.wpm);
    expect(fast.submit.body.result.accuracy).toBe(100);
    expect(fast.submit.body.flagged).toBe(false);
    expect(fast.submit.body.rank).toBe(1);
    expect(slow.submit.body.rank).toBe(2);

    const board = await call("GET", `/tests/${t.id}/leaderboard`, { token: a.token });
    expect(board.body.entries.map((e: any) => e.username)).toEqual([a.username, b.username]);
    expect(board.body.entries[0]).toMatchObject({ rank: 1 });
    const mine = (await call("GET", "/tests", { token: a.token })).body.tests.find((x: any) => x.id === t.id);
    expect(mine.myAttempts).toBe(1);
    expect(mine.myBestWpm).toBeCloseTo(fast.submit.body.result.wpm);
  });

  it("scores from the keystrokes, ignoring whatever speed a client claims", async () => {
    const t = await makeTest();
    const s = await newStudent();
    const started = await start(s.token, t.id);
    const log = typeLog(started.body.text, started.body.durationMs, 5);
    const r = await call("POST", `/attempts/${started.body.attemptId}/submit`, {
      token: s.token,
      body: { log, wpm: 999, accuracy: 100 },
    });
    expect(r.status).toBe(200);
    expect(r.body.result.wpm).toBeLessThan(100);
  });

  it("limits attempts, resumes an unfinished start, and refuses a second submit", async () => {
    const t = await makeTest({ maxAttempts: 2 });
    const s = await newStudent();
    const first = await start(s.token, t.id);
    const resumed = await start(s.token, t.id);
    expect(resumed.body.attemptId).toBe(first.body.attemptId);
    expect(resumed.body.text).toBe(first.body.text);

    const submitted = await call("POST", `/attempts/${first.body.attemptId}/submit`, {
      token: s.token,
      body: { log: typeLog(first.body.text, 10_000, 5) },
    });
    expect(submitted.status).toBe(200);
    const twice = await call("POST", `/attempts/${first.body.attemptId}/submit`, { token: s.token, body: { log: [] } });
    expect(twice.status).toBe(409);

    // Attempt 2 of 2.
    const secondStart = await start(s.token, t.id);
    expect(secondStart.status).toBe(201);
    expect(secondStart.body.attemptId).not.toBe(first.body.attemptId);
    await call("POST", `/attempts/${secondStart.body.attemptId}/submit`, {
      token: s.token,
      body: { log: typeLog(secondStart.body.text, 10_000, 5) },
    });
    const third = await start(s.token, t.id);
    expect(third.status).toBe(409);
    expect(third.body.error).toBe("no_attempts_left");
  });

  it("stops a student submitting someone else's attempt, and teachers submitting at all", async () => {
    const t = await makeTest();
    const a = await newStudent();
    const b = await newStudent();
    const started = await start(a.token, t.id);
    const steal = await call("POST", `/attempts/${started.body.attemptId}/submit`, { token: b.token, body: { log: [] } });
    expect(steal.status).toBe(404);
    expect((await start(teacherToken, t.id)).status).toBe(403);
  });

  it("only lets students start inside the window, and never a cancelled test", async () => {
    const s = await newStudent();
    const future = await makeTest({ startsAt: iso(HOUR), endsAt: iso(2 * HOUR) });
    expect(future.status).toBe("upcoming");
    expect((await start(s.token, future.id)).body.error).toBe("not_started");
    const past = await makeTest({ startsAt: iso(-2 * HOUR), endsAt: iso(-HOUR) });
    expect((await start(s.token, past.id)).body.error).toBe("ended");

    const live = await makeTest();
    await call("PATCH", `/tests/${live.id}`, { token: teacherToken, body: { cancelled: true } });
    expect((await start(s.token, live.id)).status).toBe(404);
    const list = await call("GET", "/tests?limit=200", { token: s.token });
    expect(list.body.tests.some((x: any) => x.id === live.id)).toBe(false);
    const staffList = await call("GET", "/tests?status=cancelled", { token: teacherToken });
    expect(staffList.body.tests.some((x: any) => x.id === live.id)).toBe(true);
  });

  it("lets a teacher move the window of a test", async () => {
    const t = await makeTest({ startsAt: iso(HOUR), endsAt: iso(2 * HOUR) });
    const s = await newStudent();
    expect((await start(s.token, t.id)).status).toBe(409);
    const moved = await call("PATCH", `/tests/${t.id}`, { token: teacherToken, body: { startsAt: iso(-1000) } });
    expect(moved.body.test.status).toBe("active");
    expect((await start(s.token, t.id)).status).toBe(201);
    const bad = await call("PATCH", `/tests/${t.id}`, { token: teacherToken, body: { endsAt: iso(-HOUR) } });
    expect(bad.status).toBe(400);
  });

  it("holds back suspicious results until a teacher clears them", async () => {
    const t = await makeTest();
    const honest = await newStudent();
    const robot = await newStudent();
    await finish(honest.token, t.id, 5);
    const bot = await finish(robot.token, t.id, 12, false); // perfectly even keystrokes
    expect(bot.submit.body.flagged).toBe(true);
    expect(bot.submit.body.flagReason).toContain("perfectly regular");

    let board = await call("GET", `/tests/${t.id}/leaderboard`, { token: honest.token });
    expect(board.body.entries.map((e: any) => e.username)).toEqual([honest.username]);

    const all = await call("GET", `/tests/${t.id}/attempts`, { token: teacherToken });
    const flagged = all.body.attempts.find((a: any) => a.flagged);
    expect(flagged.username).toBe(robot.username);

    expect((await call("PATCH", `/attempts/${flagged.id}`, { token: honest.token, body: { flagged: false } })).status).toBe(403);
    await call("PATCH", `/attempts/${flagged.id}`, { token: teacherToken, body: { flagged: false } });
    board = await call("GET", `/tests/${t.id}/leaderboard`, { token: honest.token });
    expect(board.body.entries.map((e: any) => e.username)).toEqual([robot.username, honest.username]);
  });

  it("leaves results under a test's minimum accuracy off its leaderboard", async () => {
    const t = await makeTest({ minAccuracy: 95 });
    const s = await newStudent();
    const started = await start(s.token, t.id);
    // Type the wrong letter for every key: accuracy is nowhere near 95.
    const log = typeLog(started.body.text, 10_000, 5).map((e) => ({ ...e, c: e.c === "z" ? "q" : "z" }));
    const r = await call("POST", `/attempts/${started.body.attemptId}/submit`, { token: s.token, body: { log } });
    expect(r.body.belowMinAccuracy).toBe(true);
    const board = await call("GET", `/tests/${t.id}/leaderboard`, { token: s.token });
    expect(board.body.entries).toEqual([]);
  });

  it("rejects a malformed log", async () => {
    const t = await makeTest();
    const s = await newStudent();
    const started = await start(s.token, t.id);
    const backwards = await call("POST", `/attempts/${started.body.attemptId}/submit`, {
      token: s.token,
      body: { log: [{ t: 500, c: "a" }, { t: 100, c: "b" }] },
    });
    expect(backwards.status).toBe(400);
  });
});

// ---- Practice results and global leaderboards ---------------------------------

describe("practice results and leaderboards", () => {
  const post = (token: string, over: Record<string, unknown> = {}) => {
    const text = (over.text as string) ?? buildText("en", 200);
    return call("POST", "/results", {
      token,
      body: {
        clientId: crypto.randomUUID(),
        language: "en",
        mode: "time",
        value: 10,
        punctuation: false,
        numbers: false,
        text,
        log: typeLog(text, 10_000, 6),
        ...over,
      },
    });
  };
  const board = (token: string, period: string, extra = "") =>
    call("GET", `/leaderboards?language=en&mode=time&value=10&period=${period}${extra}`, { token });

  it("puts a verified result on the week, month and all-time boards", async () => {
    const s = await newStudent();
    const r = await post(s.token);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ verified: true, onLeaderboard: true, duplicate: false });
    expect(r.body.records.sort()).toEqual(["all", "month", "week"]);
    for (const period of ["week", "month", "all"]) {
      const b = await board(s.token, period);
      expect(b.body.entries.map((e: any) => e.username)).toContain(s.username);
    }
  });

  it("keeps only the highest score and says when a record is broken", async () => {
    const s = await newStudent();
    const text = buildText("en", 400);
    const slow = await post(s.token, { text, log: typeLog(text, 10_000, 4) });
    const fast = await post(s.token, { text, log: typeLog(text, 10_000, 8) });
    const slowerAgain = await post(s.token, { text, log: typeLog(text, 10_000, 3) });
    expect(fast.body.records.length).toBe(3);
    expect(slowerAgain.body.records).toEqual([]);

    const b = await board(s.token, "all", "&limit=200");
    const row = b.body.entries.find((e: any) => e.username === s.username);
    expect(row.wpm).toBeCloseTo(fast.body.result.wpm);
    expect(row.wpm).toBeGreaterThan(slow.body.result.wpm);
    expect(b.body.entries.filter((e: any) => e.username === s.username)).toHaveLength(1);
    // Every attempt is still recorded for the student's history.
    const history = await call("GET", `/users/${s.id}/attempts`, { token: s.token });
    expect(history.body.attempts).toHaveLength(3);
  });

  it("does not count the same upload twice", async () => {
    const s = await newStudent();
    const text = buildText("en", 200);
    const body = { clientId: crypto.randomUUID(), language: "en", mode: "time", value: 10, text, log: typeLog(text, 10_000, 6) };
    expect((await call("POST", "/results", { token: s.token, body })).status).toBe(201);
    const again = await call("POST", "/results", { token: s.token, body });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    const history = await call("GET", `/users/${s.id}/attempts`, { token: s.token });
    expect(history.body.attempts).toHaveLength(1);
  });

  it("ranks students by speed", async () => {
    const [a, b, c] = [await newStudent(), await newStudent(), await newStudent()];
    const text = buildText("en", 400);
    await post(a.token, { text, log: typeLog(text, 10_000, 5) });
    await post(b.token, { text, log: typeLog(text, 10_000, 9) });
    await post(c.token, { text, log: typeLog(text, 10_000, 7) });
    const res = await board(a.token, "week", "&limit=200");
    const order = res.body.entries.map((e: any) => e.username).filter((u: string) => [a, b, c].some((x) => x.username === u));
    expect(order).toEqual([b.username, c.username, a.username]);
    expect(res.body.entries[0].rank).toBe(1);
  });

  it("shows a student their own place when they are outside the top list", async () => {
    const s = await newStudent();
    const text = buildText("en", 400);
    await post(s.token, { text, log: typeLog(text, 10_000, 1) });
    const res = await board(s.token, "all", "&limit=1");
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.me.username).toBe(s.username);
    expect(res.body.me.rank).toBeGreaterThan(1);
  });

  it("keeps results that cannot be trusted off the boards", async () => {
    const s = await newStudent();

    // Text the generator could not have made is stored but not ranked: a word repeated...
    const rigged = "a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a";
    const r1 = await post(s.token, { text: rigged, log: typeLog(rigged, 10_000, 8) });
    expect(r1.body).toMatchObject({ verified: false, onLeaderboard: false, records: [] });
    // ...a short cycle of tiny words...
    const cycle = Array.from({ length: 60 }, (_, i) => ["to", "of", "in"][i % 3]).join(" ");
    expect((await post(s.token, { text: cycle, log: typeLog(cycle, 10_000, 8) })).body.verified).toBe(false);
    // ...and words that are not in the list at all.
    const madeUp = Array.from({ length: 60 }, (_, i) => `zzq${i}`).join(" ");
    expect((await post(s.token, { text: madeUp, log: typeLog(madeUp, 10_000, 8) })).body.verified).toBe(false);

    // Punctuation and numbers are practice only.
    const text = buildText("en", 400, { punctuation: true });
    const r2 = await post(s.token, { text, punctuation: true, log: typeLog(text, 10_000, 8) });
    expect(r2.body).toMatchObject({ verified: true, onLeaderboard: false });

    // Below the minimum accuracy.
    const plain = buildText("en", 400);
    const sloppy = typeLog(plain, 10_000, 8).map((e, i) => (i % 3 === 0 ? { ...e, c: "#" } : e));
    const r3 = await post(s.token, { text: plain, log: sloppy });
    expect(r3.body.result.accuracy).toBeLessThan(90);
    expect(r3.body.onLeaderboard).toBe(false);

    // Machine-regular timing is flagged and held.
    const r4 = await post(s.token, { text: plain, log: typeLog(plain, 10_000, 12, false) });
    expect(r4.body).toMatchObject({ flagged: true, onLeaderboard: false });

    const res = await board(s.token, "all", "&limit=200");
    expect(res.body.entries.some((e: any) => e.username === s.username)).toBe(false);
  });

  it("files an old offline result under its own week, not this week", async () => {
    const s = await newStudent();
    const text = buildText("en", 400);
    const old = new Date(Date.now() - 25 * 86_400_000).toISOString();
    const r = await post(s.token, { text, log: typeLog(text, 10_000, 6), completedAt: old });
    expect(r.body.records).toContain("all");
    expect((await board(s.token, "all", "&limit=200")).body.entries.some((e: any) => e.username === s.username)).toBe(true);
    expect((await board(s.token, "week", "&limit=200")).body.entries.some((e: any) => e.username === s.username)).toBe(false);
  });

  it("ignores a claimed time far in the future", async () => {
    const s = await newStudent();
    const text = buildText("en", 400);
    const r = await post(s.token, { text, log: typeLog(text, 10_000, 6), completedAt: "2099-01-01T00:00:00Z" });
    expect(r.body.records.sort()).toEqual(["all", "month", "week"]);
  });

  it("keeps a separate board for each difficulty level", async () => {
    const s = await newStudent();
    const text = buildText("en", 400, { level: 5000 });
    const r = await post(s.token, { level: 5000, text, log: typeLog(text, 10_000, 6) });
    expect(r.body.onLeaderboard).toBe(true);
    const at5k = await call("GET", "/leaderboards?language=en&level=5000&mode=time&value=10&period=all&limit=200", { token: s.token });
    expect(at5k.body.entries.some((e: any) => e.username === s.username)).toBe(true);
    expect(at5k.body.board).toBe("en:5000:time:10");
    const at1k = await call("GET", "/leaderboards?language=en&level=1000&mode=time&value=10&period=all&limit=200", { token: s.token });
    expect(at1k.body.entries.some((e: any) => e.username === s.username)).toBe(false);
    expect((await call("GET", "/leaderboards?level=300", { token: s.token })).status).toBe(400);
  });

  it("will not accept text drawn from a deeper level than the one claimed", async () => {
    const s = await newStudent();
    const hard = buildText("en", 400, { level: 10000 });
    const claimsEasy = await post(s.token, { level: 200, text: hard, log: typeLog(hard, 10_000, 6) });
    expect(claimsEasy.body.verified).toBe(false);
    const claimsRight = await post(s.token, { level: 10000, text: hard, log: typeLog(hard, 10_000, 6) });
    expect(claimsRight.body.verified).toBe(true);
  });

  it("keeps separate boards for each language and length", async () => {
    const s = await newStudent();
    const text = buildText("hi", 400);
    const r = await post(s.token, { language: "hi", value: 10, text, log: typeLog(text, 10_000, 5) });
    expect(r.body.onLeaderboard).toBe(true);
    const hindi = await call("GET", "/leaderboards?language=hi&mode=time&value=10&period=all&limit=200", { token: s.token });
    expect(hindi.body.entries.some((e: any) => e.username === s.username)).toBe(true);
    const sixty = await call("GET", "/leaderboards?language=hi&mode=time&value=60&period=all&limit=200", { token: s.token });
    expect(sixty.body.entries.some((e: any) => e.username === s.username)).toBe(false);
  });

  it("handles a words test and insists the word count is right", async () => {
    const s = await newStudent();
    const words = buildText("en", 200).split(" ").slice(0, 20).join(" ");
    const log = typeLog(words, 60_000, 7);
    const r = await post(s.token, { mode: "words", value: 20, text: words, log });
    expect(r.body).toMatchObject({ verified: true, onLeaderboard: true });
    const wrong = await post(s.token, { mode: "words", value: 25, text: words, log });
    expect(wrong.status).toBe(400);
    // Stopping halfway through a words test is not a result worth ranking.
    const half = await post(s.token, { mode: "words", value: 20, text: words, log: log.slice(0, 40) });
    expect(half.body.verified).toBe(false);
  });

  it("only accepts results from students", async () => {
    const text = buildText("en", 200);
    const r = await call("POST", "/results", {
      token: teacherToken,
      body: { clientId: crypto.randomUUID(), language: "en", mode: "time", value: 10, text, log: typeLog(text, 10_000, 6) },
    });
    expect(r.status).toBe(403);
  });

  it("lets a student see only their own history, and teachers anyone's", async () => {
    const a = await newStudent();
    const b = await newStudent();
    expect((await call("GET", `/users/${b.id}/attempts`, { token: a.token })).status).toBe(403);
    expect((await call("GET", `/users/${b.id}/attempts`, { token: teacherToken })).status).toBe(200);
  });
});

describe("health", () => {
  it("answers the keep-awake ping without a login", async () => {
    expect((await call("GET", "/health")).body).toEqual({ ok: true });
    expect((await call("GET", "/health/db")).body).toEqual({ ok: true });
  });
});

// Keep the type import used even if the harness changes.
void TypingSession;
