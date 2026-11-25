// S18b agreements dashboard — owner UAT «a dashboard of all maintenance
// agreements, filtered by hospital and equipment type».
//
// The one place that turns the page's URL into `MaintenanceAgreementQuery`
// and back, and into the flat chips the shared `FilterBar` renders. The URL
// uses the API's own parameter names, repeated for the multi-value filters,
// so a filtered dashboard is a link someone can send and the API reads the
// same spelling (`GET /maintenance/agreements`).
//
// Each chip's key is `<facet>__<value>` (or the bare "q"), as S02 does, so
// removing one hospital chip drops that hospital and not the whole facet.

import { AgreementExpiryBand, AssetClass, MaintenanceAgreementQuery, type MaintenanceAgreementRow } from "@ecapital/shared";
import type { FilterItem } from "@/components/filter-bar";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export const AGREEMENT_FACETS = ["orgUnitId", "assetClass", "contractorId", "band"] as const;
export type AgreementFacet = (typeof AGREEMENT_FACETS)[number];

/** Anything the schema refuses (an unknown band, a stray class) is dropped, not thrown. */
export function parseAgreementsQuery(params: URLSearchParams): MaintenanceAgreementQuery {
  const parsed = MaintenanceAgreementQuery.safeParse({
    orgUnitId: params.getAll("orgUnitId"),
    assetClass: params.getAll("assetClass"),
    contractorId: params.getAll("contractorId"),
    band: params.getAll("band"),
    q: params.get("q") ?? undefined,
  });
  if (parsed.success) return parsed.data;
  return MaintenanceAgreementQuery.parse({
    orgUnitId: params.getAll("orgUnitId").filter(Boolean),
    assetClass: params.getAll("assetClass").filter((v) => AssetClass.safeParse(v).success),
    contractorId: params.getAll("contractorId").filter(Boolean),
    band: params.getAll("band").filter((v) => AgreementExpiryBand.safeParse(v).success),
    q: (params.get("q") ?? "").slice(0, 200),
  });
}

export function agreementsQueryToSearchParams(query: MaintenanceAgreementQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const facet of AGREEMENT_FACETS) for (const value of query[facet]) params.append(facet, value);
  if (query.q.trim()) params.set("q", query.q.trim());
  return params;
}

export function agreementsHref(pathname: string, query: MaintenanceAgreementQuery): string {
  const qs = agreementsQueryToSearchParams(query).toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** The per-unit view (S18b's original body) opened on this one agreement. */
export function agreementDetailHref(row: Pick<MaintenanceAgreementRow, "id" | "orgUnitId">): string {
  const params = new URLSearchParams({ view: "agreement", unit: row.orgUnitId, agreement: row.id });
  return `/maintenance/plan?${params.toString()}`;
}

export function toggleFacet(query: MaintenanceAgreementQuery, facet: AgreementFacet, value: string): MaintenanceAgreementQuery {
  const current = query[facet] as string[];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return MaintenanceAgreementQuery.parse({ ...query, [facet]: next });
}

export interface FacetLabels {
  unitName: (id: string) => string;
  contractorName: (id: string) => string;
}

export function agreementsQueryToFilterItems(query: MaintenanceAgreementQuery, labels: FacetLabels, t: Translate): FilterItem[] {
  const items: FilterItem[] = [];
  for (const id of query.orgUnitId) {
    items.push({ key: `orgUnitId__${id}`, label: t("screens.s18plan.dashboard.filters.unit"), value: labels.unitName(id) });
  }
  for (const c of query.assetClass) {
    items.push({ key: `assetClass__${c}`, label: t("screens.s18plan.dashboard.filters.assetClass"), value: t(`assetClass.${c}`) });
  }
  for (const id of query.contractorId) {
    items.push({ key: `contractorId__${id}`, label: t("screens.s18plan.dashboard.filters.contractor"), value: labels.contractorName(id) });
  }
  for (const b of query.band) {
    items.push({ key: `band__${b}`, label: t("screens.s18plan.dashboard.filters.band"), value: t(`screens.s18plan.dashboard.band.${b}`) });
  }
  if (query.q.trim()) items.push({ key: "q", label: t("common.search"), value: query.q.trim() });
  return items;
}

/** FilterBar hands back the next full list after a chip is removed, «clear all» or a saved view. */
export function filterItemsToAgreementsQuery(items: FilterItem[]): MaintenanceAgreementQuery {
  const next: Record<AgreementFacet, string[]> = { orgUnitId: [], assetClass: [], contractorId: [], band: [] };
  let q = "";
  for (const item of items) {
    if (item.key === "q") {
      q = item.value;
      continue;
    }
    const at = item.key.indexOf("__");
    if (at < 0) continue;
    const facet = item.key.slice(0, at) as AgreementFacet;
    if (AGREEMENT_FACETS.includes(facet)) next[facet].push(item.key.slice(at + 2));
  }
  return MaintenanceAgreementQuery.parse({ ...next, q });
}
