// S02 — R03, R06
//
// The single place that turns the browser's `URLSearchParams` into a full
// `ProjectListQuery` and back. Both `ProjectsScreen` (reading the current
// URL) and the mock `GET /api/projects` handler (`src/app/api/projects/route.ts`)
// parse query strings the same way — repeated params for the array filters,
// case- and accent-insensitive `q` — so this module intentionally mirrors
// that handler's `parseQuery` rather than reusing it directly (one is a
// server module reading `NextRequest`, the other a plain client helper
// reading the browser's `URLSearchParams`; the parsing rule is the shared
// contract, `ProjectListQuery` itself, not the code).

import { ProjectListQuery } from "@ecapital/shared";

export function parseProjectsQuery(searchParams: URLSearchParams): ProjectListQuery {
  return ProjectListQuery.parse({
    unit: searchParams.getAll("unit"),
    phase: searchParams.getAll("phase"),
    category: searchParams.getAll("category"),
    rag: searchParams.getAll("rag"),
    q: searchParams.get("q") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    dir: searchParams.get("dir") ?? undefined,
    page: searchParams.has("page") ? Number(searchParams.get("page")) : undefined,
    pageSize: searchParams.has("pageSize") ? Number(searchParams.get("pageSize")) : undefined,
  });
}

// The all-defaults query, computed once, so the serializer below can leave a
// field out of the URL when it is already at its default — a filtered-and-
// sorted view still shares a bookmarkable, uncluttered URL with the plain one.
const DEFAULTS = ProjectListQuery.parse({});

export function projectsQueryToSearchParams(query: ProjectListQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const unit of query.unit) params.append("unit", unit);
  for (const phase of query.phase) params.append("phase", phase);
  for (const category of query.category) params.append("category", category);
  for (const rag of query.rag) params.append("rag", rag);
  if (query.q) params.set("q", query.q);
  if (query.sort !== DEFAULTS.sort) params.set("sort", query.sort);
  if (query.dir !== DEFAULTS.dir) params.set("dir", query.dir);
  if (query.page !== DEFAULTS.page) params.set("page", String(query.page));
  if (query.pageSize !== DEFAULTS.pageSize) params.set("pageSize", String(query.pageSize));
  return params;
}

/** The mock handler's path (relative, no leading `/api` — `mockFetch` adds that). */
export function projectsApiPath(query: ProjectListQuery): string {
  const qs = projectsQueryToSearchParams(query).toString();
  return qs ? `/projects?${qs}` : "/projects";
}
