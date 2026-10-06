import {
  AccrualRow,
  AdminUserList,
  AffectedArea,
  ApproverScopes,
  AreaTree,
  AssetDetail,
  AssetListRow,
  BudgetCodeList,
  BudgetLine,
  CalendarEntry,
  CashflowRow,
  ConfigLinks,
  Contractor,
  ContractDetail,
  ContractList,
  EFinanceInvoiceList,
  EFinanceRequisitionList,
  EFinanceVendorList,
  ProjectBudgetPosition,
  Defect,
  DisruptionHoursRow,
  ImportBatch,
  Inbox,
  IcraMatrixVersion,
  PaymentCert,
  PermitListRow,
  PortfolioResponse,
  ProjectCost,
  ProjectDetail,
  ProjectList,
  QrLabel,
  ReplacementForecastRow,
  Rfi,
  RoleCatalogue,
  ShutdownPermit,
  SiteInstruction,
  SystemFeed,
  UnmatchedQueue,
  BacklogItem,
  BacklogSummaryRow,
  MaintenanceContract,
  MaintenanceSummary,
  PmSchedule,
  Scorecard,
  SlaSystem,
  WorkOrderDetail,
  WorkOrderListRow,
  AssetLifecycleReport,
  BacklogByBandReport,
  CapitalProgrammeReport,
  ClinicalDisruptionReport,
  ContractorScorecardReport,
  ExceptionsReport,
  ReportCatalogueEntry,
  StatutoryComplianceReport,
  REPORT_SLUG,
  type ReportKey,
  type ReportQuery,
  type AreaType,
  type AssetClass,
  type BacklogListQuery,
  type Condition,
  type AssetStatus,
  type PermitSystem,
  type ProjectListQuery,
  type ScorecardQuery,
  type WorkOrderListQuery,
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
    // S10's bulk-assign picker asks before a project is chosen; nothing to
    // fetch until there is one (a bare `/projects//contracts` is a 404).
    enabled: projectId !== "",
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

// S07a's «Κωδικός προϋπολογισμού» select, S07's facts list and S07e's
// optional column (ADR-0025). Any signed-in role may read the list, and it
// changes about as often as the org unit list does — worth caching for the
// length of the session the same way `useConfigLinks` does.
export function useBudgetCodes() {
  return useQuery({
    queryKey: ["budget-codes"],
    queryFn: () => proxyFetch("/budget-codes?kind=capex", BudgetCodeList),
    select: (page) => page.items,
    staleTime: Infinity,
    retry: false,
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
    // The API answers `{ items, total }` (newest first), like the other lists.
    queryFn: () => proxyFetch("/cost/imports", z.object({ items: z.array(ImportBatch), total: z.number().int() })),
    select: (page) => page.items,
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

// ------------------------------------------------------------ M3 (R19–R25)
// S11–S15, S24's approver scopes, S03's «Ανοικτές άδειες» card. Same shape as
// every hook above — `proxyFetch`, keyed on the arguments that change the
// result, `retry: false` — plus the mutation paths the Screens call through
// `apiMutate` directly (not hooks: every screen in this module already
// re-`refetch()`s after a write, the same pattern `RfisScreen` sets).

// S11 step 1's «Έργο/Σύμβαση» is optional and reads `useProjectsForUnit` /
// `useContracts`, already above; nothing new needed there.

// S11 step 2: what a system feeds beyond the areas the engineer picked.
export function useSystemFeeds(orgUnitId: string) {
  return useQuery({
    queryKey: ["system-feeds", orgUnitId],
    queryFn: () => proxyFetch(`/system-feeds?orgUnitId=${encodeURIComponent(orgUnitId)}`, z.array(SystemFeed)),
    retry: false,
    enabled: orgUnitId.length > 0,
  });
}

/** Builds `GET /areas/impact`'s query string from the picked systems and areas. */
export function areasImpactPath(orgUnitId: string, systems: PermitSystem[], areaIds: string[]): string {
  const params = new URLSearchParams({ orgUnitId, systems: systems.join(","), areaIds: areaIds.join(",") });
  return `/areas/impact?${params.toString()}`;
}

// S11 step 2: direct + indirect affected areas for the picked systems/areas.
export function useAreaImpact(orgUnitId: string, systems: PermitSystem[], areaIds: string[]) {
  return useQuery({
    queryKey: ["area-impact", orgUnitId, systems, areaIds],
    queryFn: () => proxyFetch(areasImpactPath(orgUnitId, systems, areaIds), z.array(AffectedArea)),
    retry: false,
    enabled: orgUnitId.length > 0 && systems.length > 0 && areaIds.length > 0,
  });
}

// S12: the active ICRA matrix version, for the version id under the badge
// and (until `/icra/evaluate` is called) the four activity-type cards.
export function useIcraMatrix() {
  return useQuery({
    queryKey: ["icra-matrix"],
    queryFn: () => proxyFetch("/icra/matrix", IcraMatrixVersion),
    retry: false,
    staleTime: Infinity,
  });
}

// S11 list, S11a's own record once created, S03's «Ανοικτές άδειες» card.
export interface PermitsListQuery {
  orgUnitId?: string;
  status?: string[];
  system?: string;
  areaType?: string;
  q?: string;
  page: number;
  pageSize: number;
}

export function permitsApiPath(query: PermitsListQuery): string {
  const params = new URLSearchParams();
  if (query.orgUnitId) params.set("orgUnitId", query.orgUnitId);
  for (const s of query.status ?? []) params.append("status", s);
  if (query.system) params.set("system", query.system);
  if (query.areaType) params.set("areaType", query.areaType);
  if (query.q?.trim()) params.set("q", query.q.trim());
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return `/permits?${params.toString()}`;
}

export function usePermits(query: PermitsListQuery) {
  return useQuery({
    queryKey: ["permits", query],
    queryFn: () => proxyFetch(permitsApiPath(query), z.object({ items: z.array(PermitListRow), total: z.number().int() })),
    retry: false,
  });
}

// S03's «Ανοικτές άδειες» card: this project's own permits, any non-closed status.
export function useProjectPermits(projectId: string) {
  return useQuery({
    queryKey: ["project-permits", projectId],
    queryFn: () =>
      proxyFetch(
        permitsApiPath({ status: ["DRAFT", "SUBMITTED", "CLINICAL_REVIEW", "APPROVED", "ACTIVE", "BREACH"], page: 1, pageSize: 50 }),
        z.object({ items: z.array(PermitListRow), total: z.number().int() }),
      ).then((page) => page.items.filter((row) => row.projectId === projectId)),
    retry: false,
    enabled: projectId.length > 0,
  });
}

// S11/S12 detail, S13 print, the permit detail screen.
export function usePermit(id: string) {
  return useQuery({
    queryKey: ["permit", id],
    queryFn: () => proxyFetch(`/permits/${encodeURIComponent(id)}`, ShutdownPermit),
    retry: false,
    enabled: id.length > 0,
  });
}

// S15 disruption calendar.
export interface CalendarQueryArgs {
  from: string;
  to: string;
  orgUnitId?: string;
  areaType?: AreaType;
  system?: PermitSystem;
}

export function calendarApiPath(query: CalendarQueryArgs): string {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.orgUnitId) params.set("orgUnitId", query.orgUnitId);
  if (query.areaType) params.set("areaType", query.areaType);
  if (query.system) params.set("system", query.system);
  return `/calendar?${params.toString()}`;
}

export function useCalendar(query: CalendarQueryArgs) {
  return useQuery({
    queryKey: ["calendar", query],
    queryFn: () => proxyFetch(calendarApiPath(query), z.array(CalendarEntry)),
    retry: false,
  });
}

// S15's «Ώρες κλινικής διατάραξης» table.
export function useDisruptionHours(year: number) {
  return useQuery({
    queryKey: ["disruption-hours", year],
    queryFn: () => proxyFetch(`/calendar/disruption-hours?year=${year}`, z.array(DisruptionHoursRow)),
    retry: false,
  });
}

// S14 approvals inbox.
export function useInbox() {
  return useQuery({
    queryKey: ["inbox"],
    queryFn: () => proxyFetch("/inbox", Inbox),
    retry: false,
  });
}

// S24 «Χώροι και ρόλοι έγκρισης» — item 8. ASSUMPTION on the endpoint name,
// see `packages/shared/src/permit.ts`'s own note on `ApproverScopes`.
export function useApproverScopes(userId: string) {
  return useQuery({
    queryKey: ["approver-scopes", userId],
    queryFn: () => proxyFetch(`/admin/users/${encodeURIComponent(userId)}/approver-scopes`, ApproverScopes),
    retry: false,
    enabled: userId.length > 0,
  });
}

// ------------------------------------------------------------ M4 (R26–R30, R45)
// S16a, S17, S17a, S17b, S17c — `packages/shared/src/asset.ts`. Same shape as
// every hook above: `proxyFetch`, keyed on the arguments that change the
// result, `retry: false`.

export interface AssetsListQuery {
  orgUnitId?: string;
  areaId?: string;
  assetClass?: AssetClass;
  criticality?: number;
  condition?: Condition;
  status?: AssetStatus;
  q?: string;
  sort?: "tag" | "nameEl" | "criticality" | "condition" | "replacementYear" | "updatedAt";
  dir?: "asc" | "desc";
  page: number;
  pageSize: number;
}

export function assetsApiPath(query: AssetsListQuery): string {
  const params = new URLSearchParams();
  if (query.orgUnitId) params.set("orgUnitId", query.orgUnitId);
  if (query.areaId) params.set("areaId", query.areaId);
  if (query.assetClass) params.set("assetClass", query.assetClass);
  if (query.criticality) params.set("criticality", String(query.criticality));
  if (query.condition) params.set("condition", query.condition);
  if (query.status) params.set("status", query.status);
  if (query.q?.trim()) params.set("q", query.q.trim());
  params.set("sort", query.sort ?? "tag");
  params.set("dir", query.dir ?? "asc");
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return `/assets?${params.toString()}`;
}

// S16a register.
export function useAssets(query: AssetsListQuery) {
  return useQuery({
    queryKey: ["assets", query],
    queryFn: () => proxyFetch(assetsApiPath(query), z.object({ items: z.array(AssetListRow), total: z.number().int() })),
    retry: false,
  });
}

// S17 detail, S17a's own prefill.
export function useAsset(id: string) {
  return useQuery({
    queryKey: ["asset", id],
    queryFn: () => proxyFetch(`/assets/${encodeURIComponent(id)}`, AssetDetail),
    retry: false,
    enabled: id.length > 0,
  });
}

// S16's own asset count per area (item 7): the unit's full list, unpaged —
// an org unit's own register is short enough that one call and a client-side
// group-by is simpler than a second, area-scoped endpoint this build brief
// does not name.
export function useAssetsForUnit(orgUnitId: string) {
  return useQuery({
    queryKey: ["assets-for-unit", orgUnitId],
    queryFn: () =>
      // RULE (contract `AssetListQuery.pageSize`, apps/api ListQuery): the
      // API caps pageSize at 100 and 400s a larger one.
      proxyFetch(
        assetsApiPath({ orgUnitId, sort: "tag", dir: "asc", page: 1, pageSize: 100 }),
        z.object({ items: z.array(AssetListRow), total: z.number().int() }),
      ),
    select: (page) => page.items,
    retry: false,
    enabled: orgUnitId.length > 0,
  });
}

// S16a's «Εκτύπωση ετικετών» and S17b `/assets/labels`.
export function useAssetLabels(ids: string[]) {
  return useQuery({
    queryKey: ["asset-labels", ids],
    queryFn: () => proxyFetch(`/assets/labels?ids=${ids.map(encodeURIComponent).join(",")}`, z.array(QrLabel)),
    retry: false,
    enabled: ids.length > 0,
  });
}

// S17a's «Σύμβαση» select, filtered to the asset's unit — `ContractListQuery.unit`.
export function useContractsForUnit(orgUnitId: string) {
  return useQuery({
    queryKey: ["contracts-for-unit", orgUnitId],
    queryFn: () => proxyFetch(`/contracts?unit=${encodeURIComponent(orgUnitId)}`, ContractList),
    select: (page) => page.items,
    retry: false,
    enabled: orgUnitId.length > 0,
  });
}

// S17c replacement forecast.
export interface ReplacementForecastQuery {
  from: number;
  to: number;
  orgUnitId?: string;
}

export function replacementForecastApiPath(query: ReplacementForecastQuery): string {
  const params = new URLSearchParams({ from: String(query.from), to: String(query.to) });
  if (query.orgUnitId) params.set("orgUnitId", query.orgUnitId);
  return `/assets/replacement-forecast?${params.toString()}`;
}

export function useReplacementForecast(query: ReplacementForecastQuery) {
  return useQuery({
    queryKey: ["replacement-forecast", query],
    queryFn: () => proxyFetch(replacementForecastApiPath(query), z.array(ReplacementForecastRow)),
    retry: false,
  });
}

// ------------------------------------------------------------ eFinance (ADR-0029)
// None of these fail because eFinance is not configured: the API answers 200
// with `configured: false` and empty or null figures. A 502 means eFinance was
// configured and did not answer, and is the screens' own error state.

// S07f — the invoices eFinance has tagged with this contract (reversed ones
// included, each with its ledger).
export function useContractEfinanceInvoices(contractId: string) {
  return useQuery({
    queryKey: ["contract-efinance-invoices", contractId],
    queryFn: () =>
      proxyFetch(`/contracts/${encodeURIComponent(contractId)}/efinance/invoices`, EFinanceInvoiceList),
    retry: false,
  });
}

// S07g — the requisitions eFinance has tagged with this contract.
export function useContractEfinanceRequisitions(contractId: string) {
  return useQuery({
    queryKey: ["contract-efinance-requisitions", contractId],
    queryFn: () =>
      proxyFetch(`/contracts/${encodeURIComponent(contractId)}/efinance/requisitions`, EFinanceRequisitionList),
    retry: false,
  });
}

// S04 — one row per (budget code, year) the project's contracts are charged to.
export function useProjectBudgetPosition(projectId: string) {
  return useQuery({
    queryKey: ["project-budget-position", projectId],
    queryFn: () => proxyFetch(`/projects/${encodeURIComponent(projectId)}/budget-position`, ProjectBudgetPosition),
    enabled: projectId !== "",
    retry: false,
  });
}

/**
 * S24's vendor picker: eFinance's vendors by code or name, twenty at most.
 * A plain function, not a hook — the picker debounces and cancels on its own
 * and the contractor sheet is rendered in places that have no query client.
 */
export async function searchEfinanceVendors(q: string): Promise<EFinanceVendorList["items"]> {
  const list = await proxyFetch(`/efinance/vendors?q=${encodeURIComponent(q)}`, EFinanceVendorList);
  return list.items;
}

// ------------------------------------------------------------ M5 (R32–R37, ADR-0031)
// S18–S22 — `packages/shared/src/maintenance.ts`. Same shape as every hook
// above: `proxyFetch` through the same-origin proxy (which forwards any
// path, so the M5 routes need no allow-listing there), keyed on the
// arguments that change the result, `retry: false`. The writes live in each
// screen's own wrapper, through `apiMutate`/`apiMutateMultipart`, the way
// S17's do. The xlsx downloads (catalogue template, backlog export,
// scorecard) are a plain navigation to `/api/proxy/...`, the S09a pattern.

/** Query-string arrays the API reads as a repeated key (`status=OPEN&status=PAUSED`). */
function setAll(params: URLSearchParams, key: string, values: readonly string[] | undefined): void {
  for (const value of values ?? []) params.append(key, value);
}

// S18 tiles.
export function useMaintenanceSummary(orgUnitId?: string) {
  return useQuery({
    queryKey: ["maintenance-summary", orgUnitId ?? ""],
    queryFn: () =>
      proxyFetch(
        orgUnitId ? `/maintenance/summary?orgUnitId=${encodeURIComponent(orgUnitId)}` : "/maintenance/summary",
        MaintenanceSummary,
      ),
    retry: false,
  });
}

// S18b, S20, S22: the agreements the caller may see, optionally one unit's.
export function useMaintenanceContracts(orgUnitId?: string) {
  return useQuery({
    queryKey: ["maintenance-contracts", orgUnitId ?? ""],
    queryFn: () =>
      proxyFetch(
        orgUnitId ? `/maintenance/contracts?orgUnitId=${encodeURIComponent(orgUnitId)}` : "/maintenance/contracts",
        z.array(MaintenanceContract),
      ),
    retry: false,
  });
}

// S18b catalogue, S20's system picker.
export function useSlaSystems(maintenanceContractId: string) {
  return useQuery({
    queryKey: ["sla-systems", maintenanceContractId],
    queryFn: () =>
      proxyFetch(`/maintenance/contracts/${encodeURIComponent(maintenanceContractId)}/systems`, z.array(SlaSystem)),
    retry: false,
    enabled: maintenanceContractId.length > 0,
  });
}

export interface PmSchedulesQuery {
  orgUnitId?: string;
  maintenanceContractId?: string;
  active?: boolean;
}

export function pmSchedulesApiPath(query: PmSchedulesQuery): string {
  const params = new URLSearchParams();
  if (query.orgUnitId) params.set("orgUnitId", query.orgUnitId);
  if (query.maintenanceContractId) params.set("maintenanceContractId", query.maintenanceContractId);
  if (query.active !== undefined) params.set("active", String(query.active));
  const qs = params.toString();
  return qs ? `/maintenance/schedules?${qs}` : "/maintenance/schedules";
}

// S18b programme.
export function usePmSchedules(query: PmSchedulesQuery) {
  return useQuery({
    queryKey: ["pm-schedules", query],
    queryFn: () => proxyFetch(pmSchedulesApiPath(query), z.array(PmSchedule)),
    retry: false,
  });
}

export function workOrdersApiPath(query: WorkOrderListQuery): string {
  const params = new URLSearchParams();
  if (query.orgUnitId) params.set("orgUnitId", query.orgUnitId);
  if (query.kind) params.set("kind", query.kind);
  setAll(params, "status", query.status);
  if (query.band) params.set("band", query.band);
  if (query.slaState) params.set("slaState", query.slaState);
  if (query.assetId) params.set("assetId", query.assetId);
  if (query.slaSystemId) params.set("slaSystemId", query.slaSystemId);
  if (query.maintenanceContractId) params.set("maintenanceContractId", query.maintenanceContractId);
  if (query.mine) params.set("mine", "true");
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.q?.trim()) params.set("q", query.q.trim());
  params.set("sort", query.sort ?? "calledAt");
  params.set("dir", query.dir ?? "desc");
  params.set("page", String(query.page ?? 1));
  // RULE (contract `WorkOrderListQuery.pageSize`): the API caps it at 100.
  params.set("pageSize", String(Math.min(query.pageSize ?? 100, 100)));
  return `/work-orders?${params.toString()}`;
}

const WorkOrderPage = z.object({ items: z.array(WorkOrderListRow), total: z.number().int() });

// S18 list.
export function useWorkOrders(query: WorkOrderListQuery) {
  return useQuery({
    queryKey: ["work-orders", query],
    queryFn: () => proxyFetch(workOrdersApiPath(query), WorkOrderPage),
    retry: false,
  });
}

// S18a, S19.
export function useWorkOrder(id: string) {
  return useQuery({
    queryKey: ["work-order", id],
    queryFn: () => proxyFetch(`/work-orders/${encodeURIComponent(id)}`, WorkOrderDetail),
    retry: false,
    enabled: id.length > 0,
  });
}

export function backlogApiPath(query: BacklogListQuery): string {
  const params = new URLSearchParams();
  if (query.orgUnitId) params.set("orgUnitId", query.orgUnitId);
  if (query.riskBand) params.set("riskBand", query.riskBand);
  setAll(params, "status", query.status);
  if (query.kind) params.set("kind", query.kind);
  if (query.assetId) params.set("assetId", query.assetId);
  if (query.autoDrafted !== undefined) params.set("autoDrafted", String(query.autoDrafted));
  if (query.q?.trim()) params.set("q", query.q.trim());
  params.set("sort", query.sort ?? "riskBand");
  params.set("dir", query.dir ?? "asc");
  params.set("page", String(query.page ?? 1));
  params.set("pageSize", String(Math.min(query.pageSize ?? 100, 100)));
  return `/backlog?${params.toString()}`;
}

// S21 items.
export function useBacklog(query: BacklogListQuery) {
  return useQuery({
    queryKey: ["backlog", query],
    queryFn: () => proxyFetch(backlogApiPath(query), z.object({ items: z.array(BacklogItem), total: z.number().int() })),
    retry: false,
  });
}

// S21 totals by unit × band.
export function useBacklogSummary(orgUnitId?: string) {
  return useQuery({
    queryKey: ["backlog-summary", orgUnitId ?? ""],
    queryFn: () =>
      proxyFetch(
        orgUnitId ? `/backlog/summary?orgUnitId=${encodeURIComponent(orgUnitId)}` : "/backlog/summary",
        z.array(BacklogSummaryRow),
      ),
    retry: false,
  });
}

export function scorecardQueryString(query: ScorecardQuery): string {
  return new URLSearchParams({ maintenanceContractId: query.maintenanceContractId, from: query.from, to: query.to }).toString();
}

// S22. Nothing to ask until an agreement is picked.
export function useScorecard(query: ScorecardQuery) {
  return useQuery({
    queryKey: ["scorecard", query],
    queryFn: () => proxyFetch(`/maintenance/scorecard?${scorecardQueryString(query)}`, Scorecard),
    retry: false,
    enabled: query.maintenanceContractId.length > 0 && query.from.length > 0 && query.to.length > 0,
  });
}

// ------------------------------------------------------------ M6 (R39, ADR-0032)
// S23/S23a — `packages/shared/src/reports.ts`. GET /reports is the catalogue,
// GET /reports/<slug> the report and GET /reports/<slug>.xlsx the workbook,
// all three through the same-origin proxy. One query string feeds the
// screen and the download, so a figure on the screen is the figure in the
// file (ADR-0032 §1).

/** The JSON each report answers, by key. */
export const REPORT_SCHEMA = {
  CAPITAL_PROGRAMME: CapitalProgrammeReport,
  EXCEPTIONS: ExceptionsReport,
  CONTRACTOR_SCORECARD: ContractorScorecardReport,
  BACKLOG_BY_BAND: BacklogByBandReport,
  ASSET_LIFECYCLE: AssetLifecycleReport,
  CLINICAL_DISRUPTION: ClinicalDisruptionReport,
  STATUTORY_COMPLIANCE: StatutoryComplianceReport,
} as const;

export type ReportData = { [K in ReportKey]: z.infer<(typeof REPORT_SCHEMA)[K]> };

/** `orgUnitId`, `year`, `from`, `to`, `maintenanceContractId` in that order, empty ones left out. */
export function reportQueryString(query: ReportQuery): string {
  const params = new URLSearchParams();
  if (query.orgUnitId) params.set("orgUnitId", query.orgUnitId);
  if (query.year !== undefined) params.set("year", String(query.year));
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.maintenanceContractId) params.set("maintenanceContractId", query.maintenanceContractId);
  return params.toString();
}

export function reportApiPath(key: ReportKey, query: ReportQuery): string {
  const qs = reportQueryString(query);
  return `/reports/${REPORT_SLUG[key]}${qs ? `?${qs}` : ""}`;
}

/** The xlsx download: a navigation through the proxy, never a fetch (the S09a pattern; the token stays on the server). */
export function reportExportHref(key: ReportKey, query: ReportQuery): string {
  const qs = reportQueryString(query);
  return `/api/proxy/reports/${REPORT_SLUG[key]}.xlsx${qs ? `?${qs}` : ""}`;
}

// S23 index.
export function useReportCatalogue() {
  return useQuery({
    queryKey: ["report-catalogue"],
    queryFn: () => proxyFetch("/reports", z.array(ReportCatalogueEntry)),
    retry: false,
  });
}

// S23a: one report for one filter.
export function useReport<K extends ReportKey>(key: K, query: ReportQuery) {
  return useQuery({
    queryKey: ["report", key, query],
    queryFn: () => proxyFetch(reportApiPath(key, query), REPORT_SCHEMA[key] as unknown as z.ZodType<ReportData[K]>),
    retry: false,
  });
}
