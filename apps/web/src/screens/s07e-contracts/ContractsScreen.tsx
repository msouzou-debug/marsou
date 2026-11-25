"use client";

// S07e — R08
//
/**
 * ContractsScreen — the network-aware wrapper around `Contracts`, the same
 * Screen/pure split every other register on this app uses (S02's
 * `ProjectsScreen`/`Projects`). The only place that calls `useContracts()`.
 *
 * The search term lives in the URL, not in component state, so a search can
 * be shared, bookmarked and reloaded — and so `/contracts?q=…` means the same
 * thing whether a person typed it or eFinance did (ADR-0019). The difference
 * is that eFinance's `q` is resolved on the server before this screen is ever
 * rendered: `page.tsx` looks it up and redirects. By the time the list is on
 * screen with a `q` in the URL, the lookup has already said "no".
 *
 * The «Μονάδα» and «Έργο» filters live in the URL too (`unit`, repeated, and
 * `project`; see `query.ts`), and go to the API as they are. The «Έργο»
 * options are the projects of the units chosen, or of every unit the caller
 * may see while none is.
 *
 * | Prop         | Type       | Notes                                             |
 * |--------------|------------|----------------------------------------------------|
 * | q            | string?    | The term from the URL, resolved by the Server Component. |
 * | orgUnits     | OrgUnit[]? | The caller's visible units, from the server (R01). |
 * | noPermission | ReactNode  | The shell's `NoPermission`.                         |
 */
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { OrgUnit } from "@ecapital/shared";
import { ApiError } from "@/data/client";
import { useContracts, useProjectsForUnits } from "@/data/queries";
import { Contracts, type ContractsScreenState } from "./Contracts";
import { contractsFilterToSearchParams, parseContractsFilter } from "./query";

export interface ContractsScreenProps {
  q?: string;
  orgUnits?: OrgUnit[];
  noPermission: ReactNode;
}

export function ContractsScreen({ q, orgUnits = [], noPermission }: ContractsScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filter = parseContractsFilter(new URLSearchParams(searchParams.toString()));
  const { data, error, isLoading, refetch } = useContracts(q, filter);
  const projects = useProjectsForUnits(filter.unit);

  let state: ContractsScreenState;
  if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 403 ? "noPermission" : "error";
  } else if (!data || data.items.length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  return (
    <Contracts
      items={data?.items}
      state={state}
      q={q}
      onSearch={(term) => router.push(term ? `/contracts?q=${encodeURIComponent(term)}` : "/contracts")}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      orgUnits={orgUnits}
      filter={filter}
      projects={projects.data ?? []}
      onFilterChange={(next) => {
        const qs = contractsFilterToSearchParams(next).toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      }}
    />
  );
}
