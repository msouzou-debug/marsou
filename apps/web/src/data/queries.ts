import { OrgUnit, PortfolioResponse, ProjectSummary } from "@ecapital/shared";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

// TanStack Query hooks over the route handlers in src/app/api (ADR-0005).
// These do not change when the API moves to NestJS; only client.ts does.

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: () => apiFetch("/portfolio", PortfolioResponse),
  });
}

export function useOrgUnits() {
  return useQuery({
    queryKey: ["org-units"],
    queryFn: () => apiFetch("/org-units", z.array(OrgUnit)),
  });
}

export function useProjects(unitId?: string) {
  return useQuery({
    queryKey: ["projects", unitId ?? "all"],
    queryFn: () =>
      apiFetch(`/projects${unitId ? `?unit=${encodeURIComponent(unitId)}` : ""}`, z.array(ProjectSummary)),
  });
}
