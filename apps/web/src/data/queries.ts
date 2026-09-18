import { PortfolioResponse, ProjectSummary } from "@ecapital/shared";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { mockFetch } from "./client";

// TanStack Query hooks over the route handlers in src/app/api (ADR-0005).
// Only the portfolio fixtures are left here: org units now come from the
// real API, server-side, and reach the shell as props (see
// `src/data/server.ts` and `src/app/(app)/layout.tsx`).

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: () => mockFetch("/portfolio", PortfolioResponse),
  });
}

export function useProjects(unitId?: string) {
  return useQuery({
    queryKey: ["projects", unitId ?? "all"],
    queryFn: () =>
      mockFetch(`/projects${unitId ? `?unit=${encodeURIComponent(unitId)}` : ""}`, z.array(ProjectSummary)),
  });
}
