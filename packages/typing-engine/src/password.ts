/**
 * Password hashing shared by the apps and the server.
 *
 * Uses PBKDF2 from WebCrypto, which exists in browsers, Electron and Node, so
 * an account created offline on a student's PC produces the same hash format
 * the server later verifies. Stored as `pbkdf2-sha256$<iterations>$<salt>$<hash>`.
 *
 * 100k iterations is a deliberate trade-off: the free hosting tier has a
 * fraction of a CPU, and a whole class logging in at once must not queue
 * behind slow hashing. The iteration count travels with each hash, so it can
 * be raised later without breaking existing accounts.
 */
const ALGO = "pbkdf2-sha256";
export const PASSWORD_ITERATIONS = 100_000;
/** Accepted range for hashes supplied by a client (stops a client making login absurdly slow). */
const MIN_ITERATIONS = 50_000;
const MAX_ITERATIONS = 150_000;

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `${ALGO}$${iterations}$${toB64(salt)}$${toB64(hash)}`;
}

const SHAPE = /^pbkdf2-sha256\$(\d{4,7})\$([A-Za-z0-9+/]{22}==)\$([A-Za-z0-9+/]{43}=)$/;

/** True for a well-formed hash with an iteration count in the accepted range. */
export function isPasswordHash(stored: string): boolean {
  const m = SHAPE.exec(stored);
  if (!m) return false;
  const iterations = Number(m[1]);
  return iterations >= MIN_ITERATIONS && iterations <= MAX_ITERATIONS;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) return false;
  const [, iterations, salt, hash] = SHAPE.exec(stored)!;
  const actual = await derive(password, fromB64(salt!), Number(iterations));
  const expected = fromB64(hash!);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}
