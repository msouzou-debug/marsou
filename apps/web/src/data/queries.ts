import { PortfolioResponse, ProjectDetail, ProjectList, type ProjectListQuery } from "@ecapital/shared";
import { useQuery } from "@tanstack/react-query";
import { proxyFetch } from "./client";
import { projectsApiPath } from "@/screens/s02-projects/query";

// M1: S01–S03 talk to the real API (apps/api) through `proxyFetch`
// (`src/data/client.ts`) — GET /portfolio, GET /projects and
// GET /projects/:id. Chose the same-origin-proxy option over moving these
// three screens' fetching to their Server Components: the browser cannot
// hold the bearer token (ADR-0013), so a client hook cannot call `apiFetch`
// directly, but `PortfolioScreen`/`ProjectsScreen`/`ProjectOverviewScreen`
// already resolve their five/four states, `navigator.onLine` and
// `refetch()` entirely from these hooks (see each screen's own header
// comment) — rewriting all three onto server-fetched initial props plus
// `router.refresh()` for "retry" would touch far more than the data layer
// for the same result. The proxy keeps every hook, every screen and every
// test in `Portfolio.test.tsx`/`Projects.test.tsx`/`ProjectOverview.test.tsx`
// unchanged; only `mockFetch` becomes `proxyFetch` here.
//
// Org units still come from the real API server-side and reach the shell as
// props (see `src/data/server.ts` and `src/app/(app)/layout.tsx`) — that
// half of M0 already worked this way and does not go through the proxy.

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: () => proxyFetch("/portfolio", PortfolioResponse),
  });
}

// S02. `query` is the full, defaulted `ProjectListQuery` — see
// `screens/s02-projects/query.ts` for how the URL and this object stay in
// sync. Keyed on the object itself (TanStack Query deep-compares query keys),
// so any filter, sort or page change refetches.
export function useProjects(query: ProjectListQuery) {
  return useQuery({
    queryKey: ["projects", query],
    queryFn: () => proxyFetch(projectsApiPath(query), ProjectList),
    // A real failure (403/404/5xx) is exactly the noPermission/error state
    // the screen is meant to show promptly — retrying only delays it.
    retry: false,
  });
}

// S03.
export function useProjectDetail(id: string) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => proxyFetch(`/projects/${encodeURIComponent(id)}`, ProjectDetail),
    retry: false,
  });
}
