"use client";

// S03 — R08
//
// «Συμβάσεις» card (build brief §4 CAPEX-02 §3): the project's own contracts,
// each linking through to S07, with «Προσθήκη» gated the same way S07a's
// create route is (`canWriteContracts`).
//
// Pure — takes the contracts `ProjectOverviewScreen` already fetched with
// `useProjectContracts`, the same Screen/pure split every other card on this
// page follows (`MilestonesCard`, `RisksCard`, `IssuesCard` all take their
// slice of `ProjectDetail` as a prop rather than fetching it themselves).
// `ContractList` is not part of `ProjectDetail` (contracts have a life of
// their own once they exist — see `contracts.controller.ts`'s header
// comment), so it is one extra query the screen makes and one extra prop
// this card takes, rather than a second `useQuery` call inside the render
// tree `ProjectOverview.test.tsx` exercises without a `QueryClientProvider`.
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AppRole, Contract } from "@ecapital/shared";
import { canWriteContracts } from "@/auth/roles";
import { formatEUR } from "@/lib/format";

export interface ContractsCardProps {
  projectId: string;
  roles: AppRole[];
  contracts?: Contract[];
  loading?: boolean;
  error?: boolean;
}

export function ContractsCard({ projectId, roles, contracts, loading = false, error = false }: ContractsCardProps) {
  const t = useTranslations();
  const canAdd = canWriteContracts(roles);

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <div className="flex items-center justify-between gap-s-3">
        <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s03.contractsTitle")}</h2>
        {canAdd && (
          <Link
            href={`/projects/${encodeURIComponent(projectId)}/contracts/new`}
            className="text-fs-14 font-bold text-k-blue-deep underline-offset-2 hover:underline"
          >
            {t("buttons.add")}
          </Link>
        )}
      </div>

      {loading ? (
        <ul aria-hidden="true" className="mt-s-3 grid gap-s-2">
          {[0, 1].map((i) => (
            <li key={i} className="h-s-4 animate-pulse rounded-k-chip bg-k-grey" />
          ))}
        </ul>
      ) : error ? (
        <p className="mt-s-2 text-fs-14 text-k-text">{t("states.error.loadFailed")}</p>
      ) : !contracts || contracts.length === 0 ? (
        <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s03.contractsEmpty")}</p>
      ) : (
        <ul className="mt-s-3 grid gap-s-2">
          {contracts.map((contract) => (
            <li
              key={contract.id}
              className="flex items-center justify-between gap-s-3 border-t border-k-grey pt-s-2 first:border-t-0 first:pt-0"
            >
              <div>
                {/* RULE (ADR-0019): the eCapital reference, mono, above the
                    number off the tender papers. It is what eFinance stores
                    against an invoice, so it is what somebody arriving from
                    an invoice is holding. */}
                <span className="num text-fs-12 text-k-text">{contract.ref}</span>
                <Link
                  href={`/contracts/${encodeURIComponent(contract.id)}`}
                  className="block text-fs-14 font-bold text-k-blue-deep underline-offset-2 hover:underline"
                >
                  {contract.contractNo}
                </Link>
                <p className="text-fs-12 text-k-text">{contract.contractorName}</p>
              </div>
              <span className="num text-fs-14 text-k-ink">{formatEUR(contract.currentValue)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
