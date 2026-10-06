"use client";

// S23 «Αναφορές» — R39 (CAPEX-01 §11, ADR-0032)
//
/**
 * ReportIndex — one card per report, in the catalogue's order: the title
 * (the link to `/reports/<slug>`), what it shows, who it is for and which
 * filters it takes.
 *
 * | Prop         | Type                    | Notes                                           |
 * |--------------|-------------------------|-------------------------------------------------|
 * | entries      | ReportCatalogueEntry[]? | GET /reports; sorted by REPORT_CATALOGUE here.  |
 * | state        | ReportIndexState        |                                                 |
 * | onRetry      | () => void?             |                                                 |
 * | noPermission | ReactNode               |                                                 |
 *
 * States: default, loading (seven skeleton cards), empty (the API listed
 * none), error, noPermission. Offline does not apply: the index is a list
 * of links with nothing to edit, and a cached list is still right.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { REPORT_CATALOGUE, REPORT_SLUG, type ReportCatalogueEntry } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { inCatalogueOrder } from "./catalogue";

export type ReportIndexState = "default" | "loading" | "empty" | "error" | "noPermission";

export interface ReportIndexProps {
  entries?: ReportCatalogueEntry[];
  state: ReportIndexState;
  onRetry?: () => void;
  noPermission: ReactNode;
}

function filterNames(entry: ReportCatalogueEntry): Array<"unit" | "year" | "period" | "agreement"> {
  return [
    ...(entry.takesUnit ? (["unit"] as const) : []),
    ...(entry.takesYear ? (["year"] as const) : []),
    ...(entry.takesPeriod ? (["period"] as const) : []),
    ...(entry.takesAgreement ? (["agreement"] as const) : []),
  ];
}

export function ReportIndex({ entries, state, onRetry, noPermission }: ReportIndexProps) {
  const t = useTranslations();
  if (state === "noPermission") return <>{noPermission}</>;

  return (
    <>
      <PageTitle eyebrow={t("nav.reports")} title={t("screens.s23.title")} />
      <p className="mb-s-6 max-w-[760px] text-fs-16 leading-[1.6] text-k-text">{t("screens.s23.intro")}</p>

      {state === "loading" && (
        <ul aria-busy="true" aria-label={t("common.loading")} className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2 desktop:grid-cols-3">
          {REPORT_CATALOGUE.map((e) => (
            <li key={e.key} className="h-[176px] animate-pulse rounded-k bg-k-grey" />
          ))}
        </ul>
      )}

      {state === "error" && (
        <div className="rounded-k border border-k-grey bg-k-white p-s-8 text-center">
          <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
              {t("common.retry")}
            </button>
          )}
        </div>
      )}

      {state === "empty" && <p className="text-fs-16 text-k-text">{t("screens.s23.empty")}</p>}

      {state === "default" && entries && (
        <ul aria-label={t("screens.s23.listLabel")} className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2 desktop:grid-cols-3">
          {inCatalogueOrder(entries).map((entry) => (
            <li key={entry.key} className="flex flex-col gap-s-2 rounded-k border border-k-grey bg-k-white p-s-5 shadow-k">
              <h2 className="text-fs-20">
                <Link href={`/reports/${REPORT_SLUG[entry.key]}`} className="text-k-blue-deep underline-offset-2 hover:underline">
                  {t(`reportKey.${entry.key}`)}
                </Link>
              </h2>
              <p className="text-fs-16 text-k-text">{t(`screens.s23a.reports.${entry.key}.description`)}</p>
              <p className="mt-auto text-fs-14 text-k-ink">{t("screens.s23.forWhom", { who: t(`screens.s23a.reports.${entry.key}.audience`) })}</p>
              <p className="text-fs-14 text-k-ink">
                {t("screens.s23.filtersLabel", { list: filterNames(entry).map((f) => t(`screens.s23.filters.${f}`)).join(", ") })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
