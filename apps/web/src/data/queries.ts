import {
  AccrualRow,
  AdminUserList,
  AreaTree,
  BudgetLine,
  CashflowRow,
  ConfigLinks,
  Contractor,
  ContractDetail,
  ContractList,
  Defect,
  ImportBatch,
  PaymentCert,
  PortfolioResponse,
  ProjectCost,
  ProjectDetail,
  ProjectList,
  Rfi,
  RoleCatalogue,
  SiteInstruction,
  UnmatchedQueue,
  type ProjectListQuery,
} from "@ecapital/shared";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
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

// S03's «Συμβάσεις» card.
export function useProjectContracts(projectId: string) {
  return useQuery({
    queryKey: ["project-contracts", projectId],
    queryFn: () => proxyFetch(`/projects/${encodeURIComponent(projectId)}/contracts`, ContractList),
    retry: false,
  });
}

// S07e — the contract register (ADR-0019). `q` searches the two references
// and the contractor; an empty one lists everything the caller may see.
export function useContracts(q?: string) {
  const search = q?.trim() ?? "";
  return useQuery({
    queryKey: ["contracts", search],
    queryFn: () =>
      proxyFetch(search ? `/contracts?q=${encodeURIComponent(search)}` : "/contracts", ContractList),
    retry: false,
  });
}

// ADR-0019 §4 — where eMAP and eFinance live, so S07 can offer a link to
// them. Configuration, not data: it changes when the estate changes, which
// is roughly never, so it is worth caching for the length of the session.
export function useConfigLinks() {
  return useQuery({
    queryKey: ["config-links"],
    queryFn: () => proxyFetch("/config/links", ConfigLinks),
    staleTime: Infinity,
    retry: false,
  });
}

// S07.
export function useContract(id: string) {
  return useQuery({
    queryKey: ["contract", id],
    queryFn: () => proxyFetch(`/contracts/${encodeURIComponent(id)}`, ContractDetail),
    retry: false,
  });
}

// S07a's Ανάδοχος select, and S24.
export function useContractors() {
  return useQuery({
    queryKey: ["contractors"],
    queryFn: () => proxyFetch("/contractors", z.array(Contractor)),
    retry: false,
  });
}

// ------------------------------------------------------------ M1 (R09, R12)
// S07b, S07c, S07d — the site log. Each contract sub-screen reads its own
// list; `ContractDetail` (`useContract`, above) only carries the two counts
// (`rfisOpen`, `rfisBreached`) and the defects array for the contract tabs
// and the R31 warnings strip, not the full RFI/instruction rows.

// S07b.
export function useRfis(contractId: string) {
  return useQuery({
    queryKey: ["rfis", contractId],
    queryFn: () => proxyFetch(`/contracts/${encodeURIComponent(contractId)}/rfis`, z.array(Rfi)),
    retry: false,
  });
}

// S07c.
export function useSiteInstructions(contractId: string) {
  return useQuery({
    queryKey: ["site-instructions", contractId],
    queryFn: () =>
      proxyFetch(`/contracts/${encodeURIComponent(contractId)}/site-instructions`, z.array(SiteInstruction)),
    retry: false,
  });
}

// S07d. Filtered to this contract's own handover defects (ADR-0017: a
// defect raised against a contract also carries the project, but the
// contract filter is the one this screen needs).
export function useContractDefects(contractId: string) {
  return useQuery({
    queryKey: ["defects", "contract", contractId],
    queryFn: () => proxyFetch(`/defects?contract=${encodeURIComponent(contractId)}`, z.array(Defect)),
    retry: false,
  });
}

// S07d's «Χώρος» column and area select: the unit's building/floor/area tree.
export function useAreaTree(orgUnitId: string) {
  return useQuery({
    queryKey: ["area-tree", orgUnitId],
    queryFn: () => proxyFetch(`/org-units/${encodeURIComponent(orgUnitId)}/areas`, AreaTree),
    retry: false,
    enabled: orgUnitId.length > 0,
  });
}

// S07d's «target project» select (funded defects) and link: the caller's
// visible projects in one unit, unpaged (a unit's own project list is short).
export function useProjectsForUnit(orgUnitId: string) {
  return useQuery({
    queryKey: ["projects-for-unit", orgUnitId],
    queryFn: () =>
      proxyFetch(
        projectsApiPath({
          unit: [orgUnitId],
          phase: [],
          category: [],
          rag: [],
          q: "",
          sort: "approvedBudget",
          dir: "desc",
          page: 1,
          pageSize: 200,
        }),
        ProjectList,
      ),
    retry: false,
    enabled: orgUnitId.length > 0,
  });
}

// S24 «Χρήστες» (ADR-0020). Administrator only: the routes answer 403 to
// anybody else and the page itself never renders the screen for them, so a
// failure here is a real one, not a permission check in disguise.
export interface AdminUsersQuery {
  q: string;
  role: string;
  unit: string;
  active: "" | "true" | "false";
}

export function adminUsersApiPath(query: AdminUsersQuery): string {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.role) params.set("role", query.role);
  if (query.unit) params.set("unit", query.unit);
  if (query.active) params.set("active", query.active);
  // The organisation is a few hundred staff at most, so one page is the
  // whole list and the screen needs no pager. The API pages regardless.
  params.set("pageSize", "200");
  return `/admin/users?${params.toString()}`;
}

export function useAdminUsers(query: AdminUsersQuery) {
  return useQuery({
    queryKey: ["admin-users", query],
    queryFn: () => proxyFetch(adminUsersApiPath(query), AdminUserList),
    retry: false,
  });
}

// ------------------------------------------------------------ M2 (R13, R14, R16–R18, R31)
// S04, S09, S09a, S10. Same shape as every hook above: `proxyFetch`, keyed on
// the arguments that change the result, `retry: false` so a real 403/404/5xx
// reaches the screen's own error/noPermission state promptly instead of
// being retried into a slower failure.

// S04.
export function useProjectCost(projectId: string) {
  return useQuery({
    queryKey: ["project-cost", projectId],
    queryFn: () => proxyFetch(`/projects/${encodeURIComponent(projectId)}/cost`, ProjectCost),
    retry: false,
  });
}

// S04's «Ταμειακή ροή» section. `from`/`to` are "YYYY-MM".
export function useCashflow(projectId: string, from: string, to: string) {
  return useQuery({
    queryKey: ["project-cashflow", projectId, from, to],
    queryFn: () =>
      proxyFetch(
        `/projects/${encodeURIComponent(projectId)}/cost/cashflow?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        z.array(CashflowRow),
      ),
    retry: false,
    enabled: from.length > 0 && to.length > 0,
  });
}

// S04's finance-only «Γραμμές προϋπολογισμού» editor.
export function useBudgetLines(projectId: string) {
  return useQuery({
    queryKey: ["budget-lines", projectId],
    queryFn: () => proxyFetch(`/projects/${encodeURIComponent(projectId)}/budget-lines`, z.array(BudgetLine)),
    retry: false,
  });
}

// S10 list.
export function useImportBatches() {
  return useQuery({
    queryKey: ["cost-imports"],
    queryFn: () => proxyFetch("/cost/imports", z.array(ImportBatch)),
    retry: false,
  });
}

// S10 batch detail (the header facts above the unmatched queue).
export function useImportBatch(id: string) {
  return useQuery({
    queryKey: ["cost-import", id],
    queryFn: () => proxyFetch(`/cost/imports/${encodeURIComponent(id)}`, ImportBatch),
    retry: false,
  });
}

// S10's own unmatched queue. Not kept "fresh" by refetch — S10's own screen
// applies `allocate`/`skip` optimistically from each call's own response
// (the build brief: "no confirmation … using the `next` row from the
// response"), and refetches this only when the queue needs to be rebuilt
// from scratch (opening the batch, or after `commit`).
export function useUnmatchedQueue(batchId: string) {
  return useQuery({
    queryKey: ["cost-import-unmatched", batchId],
    queryFn: () => proxyFetch(`/cost/imports/${encodeURIComponent(batchId)}/unmatched`, UnmatchedQueue),
    retry: false,
  });
}

// S09 list, on a contract.
export function usePaymentCerts(contractId: string) {
  return useQuery({
    queryKey: ["payment-certs", contractId],
    queryFn: () => proxyFetch(`/contracts/${encodeURIComponent(contractId)}/payment-certs`, z.array(PaymentCert)),
    retry: false,
  });
}

// S09 detail.
export function usePaymentCert(id: string) {
  return useQuery({
    queryKey: ["payment-cert", id],
    queryFn: () => proxyFetch(`/payment-certs/${encodeURIComponent(id)}`, PaymentCert),
    retry: false,
  });
}

// S09a. `orgUnitId` narrows to one unit; omitted (or "") lists every unit the
// caller may see.
export function useAccruals(year: number, orgUnitId?: string) {
  return useQuery({
    queryKey: ["accruals", year, orgUnitId ?? ""],
    queryFn: () =>
      proxyFetch(
        orgUnitId
          ? `/cost/accruals?year=${year}&orgUnitId=${encodeURIComponent(orgUnitId)}`
          : `/cost/accruals?year=${year}`,
        z.array(AccrualRow),
      ),
    retry: false,
  });
}

/** The eight roles and their scope, so the screen hardcodes neither. */
export function useRoleCatalogue() {
  return useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => proxyFetch("/admin/roles", RoleCatalogue),
    retry: false,
    staleTime: Infinity,
  });
}
