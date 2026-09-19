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
 * | Prop         | Type       | Notes                                             |
 * |--------------|------------|----------------------------------------------------|
 * | q            | string?    | The term from the URL, resolved by the Server Component. |
 * | noPermission | ReactNode  | The shell's `NoPermission`.                         |
 */
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/data/client";
import { useContracts } from "@/data/queries";
import { Contracts, type ContractsScreenState } from "./Contracts";

export interface ContractsScreenProps {
  q?: string;
  noPermission: ReactNode;
}

export function ContractsScreen({ q, noPermission }: ContractsScreenProps) {
  const router = useRouter();
  const { data, error, isLoading, refetch } = useContracts(q);

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
    />
  );
}
