import { levelLabel, isWordLevel, type Language } from "@typing/engine";
import { ApiError, NetworkError } from "@typing/client-core";

export const formatDateTime = (iso: string | Date) =>
  new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export const formatDate = (iso: string | Date) => new Date(iso).toLocaleDateString([], { dateStyle: "medium" });

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export const languageName = (l: Language) => (l === "en" ? "English" : "हिन्दी");

/** `en:1000:time:60` → "english 1k · time 60". Boards with punctuation or numbers show the extra. */
export function boardLabel(board: string): string {
  const m = /^(en|hi):(\d+):(time|words):(\d+)((?:\+\w+)*)$/.exec(board);
  if (!m) return board;
  const level = Number(m[2]);
  const list = isWordLevel(level) ? levelLabel(m[1] as Language, level) : `${m[1]} ${level}`;
  const extras = m[5] ? ` · ${m[5].slice(1).split("+").join(" + ")}` : "";
  return `${list} · ${m[3]} ${m[4]}${extras}`;
}

/** What to show a person when something went wrong. */
export function errorMessage(e: unknown): string {
  if (e instanceof NetworkError) return "Cannot reach the server. Check the internet connection and try again.";
  if (e instanceof ApiError) return e.issues[0]?.message ?? e.message;
  return e instanceof Error ? e.message : "Something went wrong";
}

/** `YYYY-MM-DDTHH:mm` in local time, the format of a datetime-local input. */
export function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A password students can read out and type: no look-alike characters. */
export function randomPassword(length = 8) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
