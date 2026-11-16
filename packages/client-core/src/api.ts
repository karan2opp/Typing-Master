import type { LogEntry } from "@typing/engine";
import type {
  AttemptRow,
  BestRow,
  BoardResponse,
  GlobalBoard,
  LoginResponse,
  NewTest,
  ResultBody,
  ResultResponse,
  Role,
  StartedAttempt,
  SubmittedAttempt,
  SyncAccountStatus,
  TestAttemptRow,
  TestSummary,
  User,
} from "./types";

/** The server answered, and said no (wrong password, bad input, not allowed). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }

  /** The server itself is struggling (or waking up): treat like being offline and try again later. */
  get transient() {
    return this.status >= 500 || this.status === 429 || this.status === 408;
  }
}

/** The server could not be reached at all: no network, wrong address, or too slow. */
export class NetworkError extends Error {
  constructor(message = "Cannot reach the server") {
    super(message);
  }
}

export const isUnreachable = (e: unknown): boolean =>
  e instanceof NetworkError || (e instanceof ApiError && e.transient);

/**
 * What proves who is uploading: the student's login token, or this computer's device key
 * (which works for practice results only, and never runs out).
 */
export type Credential = string | { userId: string; deviceKey: string };

export interface HttpOptions {
  baseUrl: () => string;
  fetch?: typeof fetch;
  /** The free host can take close to a minute to wake up. */
  timeoutMs?: number;
}

type Query = Record<string, string | number | boolean | undefined>;

export class Http {
  constructor(private readonly options: HttpOptions) {}

  get baseUrl() {
    return this.options.baseUrl().replace(/\/+$/, "");
  }

  async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    { token, deviceKey, body, query }: { token?: string; deviceKey?: string; body?: unknown; query?: Query } = {},
  ): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") params.set(k, String(v));
    const url = `${this.baseUrl}${path}${params.size ? `?${params}` : ""}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await (this.options.fetch ?? fetch)(url, {
        method,
        signal: controller.signal,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(deviceKey ? { "x-device-key": deviceKey } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new NetworkError(controller.signal.aborted ? "The server took too long to answer" : undefined);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // A proxy error page, not our server: the status below still says what happened.
    }
    if (!res.ok) {
      const e = (data ?? {}) as { error?: string; message?: string; issues?: { path: string; message: string }[] };
      throw new ApiError(res.status, e.error ?? "error", e.message ?? `Request failed (${res.status})`, e.issues);
    }
    return data as T;
  }
}

/** Every call the apps make to the server, typed. */
export class ServerApi {
  constructor(readonly http: Http) {}

  // ---- Accounts ----------------------------------------------------------
  login = (body: { username: string; password: string }) =>
    this.http.request<LoginResponse>("POST", "/auth/login", { body });

  register = (body: { username: string; password: string; displayName: string }) =>
    this.http.request<LoginResponse>("POST", "/auth/register", { body });

  me = (token: string) => this.http.request<{ user: User }>("GET", "/auth/me", { token });

  changePassword = (token: string, body: { currentPassword: string; newPassword: string }) =>
    this.http.request<{ ok: true }>("POST", "/auth/change-password", { token, body });

  refreshToken = (token: string) => this.http.request<{ token: string; user: User }>("POST", "/auth/refresh", { token });

  registerDeviceKey = (token: string, key: string) =>
    this.http.request<{ ok: true }>("POST", "/auth/device-key", { token, body: { key } });

  syncAccounts = (
    accounts: { id: string; username: string; displayName: string; passwordHash: string; deviceKey?: string }[],
  ) =>
    this.http.request<{ results: { id: string; status: SyncAccountStatus; deviceKey: boolean }[] }>(
      "POST",
      "/sync/accounts",
      { body: { accounts } },
    );

  // ---- Results -----------------------------------------------------------
  postResult = (credential: Credential, body: ResultBody) =>
    this.http.request<ResultResponse>(
      "POST",
      "/results",
      typeof credential === "string"
        ? { token: credential, body }
        : { deviceKey: `${credential.userId}.${credential.deviceKey}`, body },
    );

  userAttempts = (token: string, userId: string, query: { limit?: number; offset?: number } = {}) =>
    this.http.request<{ attempts: AttemptRow[]; bests: BestRow[] }>("GET", `/users/${userId}/attempts`, {
      token,
      query,
    });

  leaderboard = (
    token: string,
    query: { language: string; level: number; mode: string; value: number; period: string; limit?: number },
  ) => this.http.request<GlobalBoard>("GET", "/leaderboards", { token, query });

  // ---- Staff: people -----------------------------------------------------
  listUsers = (token: string, query: { role?: Role; q?: string; limit?: number; offset?: number } = {}) =>
    this.http.request<{ users: User[]; total: number }>("GET", "/users", { token, query });

  createUser = (
    token: string,
    body: { username: string; password: string; displayName: string; role: Role },
  ) => this.http.request<{ user: User }>("POST", "/users", { token, body });

  updateUser = (token: string, id: string, body: { displayName?: string; disabled?: boolean }) =>
    this.http.request<{ user: User }>("PATCH", `/users/${id}`, { token, body });

  resetPassword = (token: string, id: string, newPassword: string) =>
    this.http.request<{ ok: true }>("POST", `/users/${id}/reset-password`, { token, body: { newPassword } });

  // ---- Hosted tests ------------------------------------------------------
  listTests = (token: string, query: { status?: string; limit?: number; offset?: number } = {}) =>
    this.http.request<{ tests: TestSummary[] }>("GET", "/tests", { token, query });

  getTest = (token: string, id: string) =>
    this.http.request<{ test: TestSummary }>("GET", `/tests/${id}`, { token });

  createTest = (token: string, body: NewTest) =>
    this.http.request<{ test: TestSummary }>("POST", "/tests", { token, body });

  updateTest = (
    token: string,
    id: string,
    body: { title?: string; startsAt?: string; endsAt?: string; cancelled?: boolean },
  ) => this.http.request<{ test: TestSummary }>("PATCH", `/tests/${id}`, { token, body });

  startAttempt = (token: string, testId: string) =>
    this.http.request<StartedAttempt>("POST", `/tests/${testId}/attempts`, { token });

  submitAttempt = (token: string, attemptId: string, log: readonly LogEntry[]) =>
    this.http.request<SubmittedAttempt>("POST", `/attempts/${attemptId}/submit`, { token, body: { log } });

  testLeaderboard = (token: string, testId: string, limit = 50) =>
    this.http.request<BoardResponse>("GET", `/tests/${testId}/leaderboard`, { token, query: { limit } });

  testAttempts = (token: string, testId: string) =>
    this.http.request<{ attempts: TestAttemptRow[] }>("GET", `/tests/${testId}/attempts`, { token });

  reviewAttempt = (token: string, attemptId: string, body: { flagged: boolean; reason?: string }) =>
    this.http.request<{ ok: true }>("PATCH", `/attempts/${attemptId}`, { token, body });
}
