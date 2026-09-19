/**
 * The query string of `GET /admin/users` as an `AdminUserListQuery`.
 *
 * Same job `project-query.ts` does for the project register, for the same
 * reason: Express hands `?role=a&role=b` back as an array and `?role=a` as a
 * string, and everything as text. The coercion belongs here rather than in
 * the shared schema, which describes the shape both ends agree on and not
 * the way one transport spells it.
 */
import { AdminUserListQuery } from "@ecapital/shared";

function repeated(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/** `?active=true` / `?active=false`; anything else means "everybody". */
function tristate(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function parseAdminUserListQuery(raw: unknown): ReturnType<typeof AdminUserListQuery.safeParse> {
  const query = (raw ?? {}) as Record<string, unknown>;
  return AdminUserListQuery.safeParse({
    q: query.q === undefined || query.q === null ? undefined : String(query.q),
    role: repeated(query.role),
    unit: repeated(query.unit),
    active: tristate(query.active),
    page: optionalNumber(query.page),
    pageSize: optionalNumber(query.pageSize),
  });
}
