/**
 * Reading the SQLSTATE back out of whatever the driver threw.
 *
 * Drizzle wraps the pg error, which wraps the server's, so the code can sit a
 * couple of `cause` levels down. Services use it to tell "the row policy said
 * no" (42501 → 403) apart from a genuine fault, and "that key is taken"
 * (23505 → a sentence naming the field) apart from a crash.
 */

/** Postgres says 42501 when a row violates a policy or a grant. */
export const INSUFFICIENT_PRIVILEGE = "42501";

/** 23505: a unique index refused the row. */
export const UNIQUE_VIOLATION = "23505";

/** 23514: a CHECK constraint refused the row — R10's guard is one of these. */
export const CHECK_VIOLATION = "23514";

export function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The name of the constraint the server refused the row on, when it said. */
export function constraintName(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const name = (current as { constraint?: unknown }).constraint;
    if (typeof name === "string") return name;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
