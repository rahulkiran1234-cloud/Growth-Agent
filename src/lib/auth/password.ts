import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Password hashing with scrypt (built into Node, so no extra dependency). The stored string carries its own
// parameters, so they can be raised later without breaking existing accounts.
const N = 16384, R = 8, P = 1, KEYLEN = 64;

const derive = (pw: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) => scrypt(pw, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(pw, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Constant-time check. Malformed or unknown hash formats simply fail. */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  try {
    const expected = Buffer.from(hash, "base64");
    const got = await derive(pw, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;
/** Verified against when an email is unknown, so "no such account" takes as long as "wrong password". */
export const dummyHash = () => (dummy ??= hashPassword("not-a-real-password"));

export const Credentials = z.object({
  email: z.string().trim().max(254).pipe(z.email("Enter a valid email address.")),
  // Upper bound stops absurdly long inputs from tying up the hasher.
  password: z.string().min(8, "Use at least 8 characters.").max(200, "That password is too long."),
});

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

