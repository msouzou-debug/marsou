/**
 * ADR-0030 — the password hash for a local account, and nothing else.
 *
 * scrypt from Node's own crypto: no dependency to keep patched, memory-hard
 * so a stolen table is slow to try against, and the parameters are written
 * into the stored string so they can be raised later without touching the
 * rows that already exist.
 *
 *   scrypt$<N>$<r>$<p>$<salt, base64>$<hash, base64>
 *
 * RULE: a password reaches `hashPassword` and `verifyPassword` and goes no
 * further. Neither logs it, keeps it or puts it in an error.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

/**
 * True when the password matches the stored string. A stored string that is
 * not in the format above verifies nothing, rather than throwing: the
 * sign-in treats it as a wrong password, which is the safe direction.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (!salt.length || !expected.length) return false;
  let actual: Buffer;
  try {
    actual = scryptSync(password, salt, expected.length, { N: n, r, p });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A hash to compare against when the account does not exist, so a sign-in
 * for an unknown name takes as long as one for a known name with a wrong
 * password. Computed once per process.
 */
export const DUMMY_HASH: string = hashPassword(randomBytes(12).toString("hex"));
