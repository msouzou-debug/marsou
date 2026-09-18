import { PortfolioResponse, ProjectDetail, ProjectList, type ProjectListQuery } from "@ecapital/shared";
import { useQuery } from "@tanstack/react-query";
import { mockFetch } from "./client";
import { projectsApiPath } from "@/screens/s02-projects/query";

// TanStack Query hooks over the route handlers in src/app/api (ADR-0005).
// Org units come from the real API, server-side, and reach the shell as
// props (see `src/data/server.ts` and `src/app/(app)/layout.tsx`); every
// project fixture below is still mock data.

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: () => mockFetch("/portfolio", PortfolioResponse),
  });
}

// S02. `query` is the full, defaulted `ProjectListQuery` — see
// `screens/s02-projects/query.ts` for how the URL and this object stay in
// sync. Keyed on the object itself (TanStack Query deep-compares query keys),
// so any filter, sort or page change refetches.
export function useProjects(query: ProjectListQuery) {
  return useQuery({
    queryKey: ["projects", query],
    queryFn: () => mockFetch(projectsApiPath(query), ProjectList),
    // Mock fixtures never fail transiently; retrying only delays the
    // noPermission/error states the screen is meant to show promptly.
    retry: false,
  });
}

// S03.
export function useProjectDetail(id: string) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => mockFetch(`/projects/${encodeURIComponent(id)}`, ProjectDetail),
    retry: false,
  });
}
