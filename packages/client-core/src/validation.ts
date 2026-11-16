/** The same rules the server enforces, so mistakes show up before a request is sent (or an offline account is made). */

export const normalizeUsername = (s: string) => s.trim().toLowerCase();

export function checkUsername(raw: string): string | null {
  return /^[a-z0-9_.-]{3,30}$/.test(normalizeUsername(raw))
    ? null
    : "Username must be 3-30 characters: letters, numbers, dot, dash or underscore";
}

export const checkPassword = (p: string): string | null =>
  p.length < 6 ? "Password must be at least 6 characters" : p.length > 128 ? "Password is too long" : null;

export const checkDisplayName = (s: string): string | null =>
  s.trim().length === 0 ? "Enter your name" : s.trim().length > 60 ? "Name is too long" : null;
