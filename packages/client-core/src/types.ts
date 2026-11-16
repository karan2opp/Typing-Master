import type { Language, LogEntry, WordLevel } from "@typing/engine";

export type Role = "admin" | "teacher" | "student";

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

/** A practice result, as uploaded. The server rebuilds the score from `log`. */
export interface ResultBody {
  /** Made on the device, so an upload retried after a dropped connection counts once. */
  clientId: string;
  language: Language;
  level: WordLevel;
  mode: "time" | "words";
  /** Seconds for a time test, word count for a words test. */
  value: number;
  punctuation: boolean;
  numbers: boolean;
  text: string;
  log: LogEntry[];
  completedAt?: string;
}

export interface ResultResponse {
  duplicate: boolean;
  id?: string;
  verified?: boolean;
  flagged?: boolean;
  onLeaderboard?: boolean;
  records: string[];
}

export type TestStatus = "upcoming" | "active" | "ended" | "cancelled";

export interface TestSummary {
  id: string;
  title: string;
  language: Language;
  durationSeconds: number;
  startsAt: string;
  endsAt: string;
  minAccuracy: number;
  maxAttempts: number;
  cancelled: boolean;
  status: TestStatus;
  participants: number;
  /** Staff only. */
  text?: string;
  /** Students only. */
  myAttempts?: number;
  myBestWpm?: number | null;
}

export interface NewTest {
  title: string;
  language: Language;
  level: WordLevel;
  durationSeconds: number;
  startsAt: string;
  endsAt: string;
  text?: string;
  punctuation?: boolean;
  numbers?: boolean;
  minAccuracy?: number;
  maxAttempts?: number;
}

export interface StartedAttempt {
  attemptId: string;
  text: string;
  durationMs: number;
  startedAt: string;
  serverNow: string;
}

export interface SubmittedAttempt {
  attemptId: string;
  result: {
    wpm: number;
    rawWpm: number;
    accuracy: number;
    consistency: number;
    correctChars: number;
    incorrectChars: number;
    extraChars: number;
    missedChars: number;
    elapsedMs: number;
  };
  flagged: boolean;
  flagReason: string | null;
  belowMinAccuracy: boolean;
  rank: number | null;
}

export interface BoardEntry {
  rank: number;
  userId: string;
  displayName: string;
  username: string;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  achievedAt: string;
}

export interface BoardResponse {
  entries: BoardEntry[];
  me: BoardEntry | null;
}

export interface GlobalBoard extends BoardResponse {
  board: string;
  period: "week" | "month" | "all";
  periodStart: string;
  minAccuracy: number;
}

export interface AttemptRow {
  id: string;
  kind: "test" | "practice";
  testId: string | null;
  testTitle: string | null;
  language: Language;
  board: string;
  durationMs: number;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  verified: boolean;
  flagged: boolean;
  flagReason: string | null;
  submittedAt: string;
}

export interface BestRow {
  board: string;
  wpm: number;
  accuracy: number;
  achievedAt: string;
}

export interface TestAttemptRow {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  correctChars: number;
  incorrectChars: number;
  flagged: boolean;
  flagReason: string | null;
  startedAt: string;
  submittedAt: string | null;
}

export type SyncAccountStatus = "created" | "exists" | "username_taken";
