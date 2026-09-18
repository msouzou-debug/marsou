/**
 * The query string of `GET /projects` as ProjectListQuery.
 *
 * Express hands `?unit=a&unit=b` back as an array and `?unit=a` as a string,
 * and everything as text. The contract types the filters as arrays and the
 * paging as numbers, so the coercion happens here rather than in the shared
 * schema: the schema describes the shape both ends agree on, not the way one
 * transport happens to spell it.
 */
import { ProjectListQuery } from "@ecapital/shared";

function repeated(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function optionalText(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function parseProjectListQuery(raw: unknown): ReturnType<typeof ProjectListQuery.safeParse> {
  const query = (raw ?? {}) as Record<string, unknown>;
  return ProjectListQuery.safeParse({
    unit: repeated(query.unit),
    phase: repeated(query.phase),
    category: repeated(query.category),
    rag: repeated(query.rag),
    q: optionalText(query.q),
    sort: optionalText(query.sort),
    dir: optionalText(query.dir),
    page: optionalNumber(query.page),
    pageSize: optionalNumber(query.pageSize),
  });
}
