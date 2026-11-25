// S07e — R08
//
// The register's two filters, «Μονάδα» and «Έργο», read from the URL and
// written back to it, so a filtered register can be shared and survives a
// refresh like every other list on this app (S02's `query.ts` is the model).
// `unit` repeats for several units; `project` is one project. The API reads
// the same two parameters (`ContractListQuery`).
//
// `q` is not here on purpose: on this route a `q` is a reference to resolve,
// and `page.tsx` redirects to the contract or says it was not found before
// the list is ever drawn (ADR-0019).

export interface ContractsFilter {
  unit: string[];
  /** "" for every project. */
  project: string;
}

export const NO_FILTER: ContractsFilter = { unit: [], project: "" };

export function parseContractsFilter(searchParams: URLSearchParams): ContractsFilter {
  return {
    unit: [...new Set(searchParams.getAll("unit").filter(Boolean))],
    project: searchParams.get("project") ?? "",
  };
}

export function contractsFilterToSearchParams(filter: ContractsFilter): URLSearchParams {
  const params = new URLSearchParams();
  for (const unit of filter.unit) params.append("unit", unit);
  if (filter.project) params.set("project", filter.project);
  return params;
}

export function isFiltered(filter: ContractsFilter): boolean {
  return filter.unit.length > 0 || filter.project !== "";
}

/** The API's path for the register (relative; `proxyFetch` adds `/api/proxy`). */
export function contractsApiPath(filter: ContractsFilter = NO_FILTER, q = ""): string {
  const params = contractsFilterToSearchParams(filter);
  if (q.trim()) params.set("q", q.trim());
  const qs = params.toString();
  return qs ? `/contracts?${qs}` : "/contracts";
}
