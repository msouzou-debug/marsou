"use client";

// S01 — R03

/**
 * Portfolio — the pure S01 screen body (UI instructions §5, §6).
 *
 * Takes data the caller already fetched and a resolved `state`; it does not
 * call `usePortfolio` itself so it can be rendered from the preview gallery
 * with fixtures (`PortfolioScreen` is the only caller that talks to the
 * network — see its header comment).
 *
 * | Prop         | Type                 | Notes                                                        |
 * |--------------|----------------------|-----------------------------------------------------------------|
 * | data         | PortfolioResponse?   | Ignored in "empty" \| "error" \| "noPermission"; required otherwise. |
 * | state        | PortfolioScreenState | Which of the five states (plus "default") to render.           |
 * | onRetry      | () => void?          | Wired to the error state's retry button.                       |
 * | onAddProject | () => void?          | Wired to the empty state's «Προσθήκη» action.                  |
 * | noPermission | ReactNode            | The shell's `NoPermission`, rendered as-is (§ below).           |
 *
 * `NoPermission` (`@/components/app-shell`) is an async Server Component and
 * this screen is a Client Component, so it cannot render `<NoPermission />`
 * directly — the caller (a Server Component: `page.tsx` or `Portfolio.preview.tsx`)
 * renders it once and passes the element down, the same way `layout.tsx`
 * composes Server and Client Components everywhere else in this app.
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { PortfolioResponse } from "@ecapital/shared";
import { EmptyState } from "@/components/empty-state";
import { KpiTile } from "@/components/kpi-tile";
import { PageTitle } from "@/components/app-shell";
import { formatDate, formatEUR, formatPct } from "@/lib/format";
import { ExceptionList } from "./ExceptionList";
import { UnitTable } from "./UnitTable";

export type PortfolioScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface PortfolioProps {
  data?: PortfolioResponse;
  state: PortfolioScreenState;
  onRetry?: () => void;
  onAddProject?: () => void;
  noPermission: ReactNode;
}

export function Portfolio({ data, state, onRetry, onAddProject, noPermission }: PortfolioProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  const eyebrow = t("app.org");
  const title = t("screens.s01.title");

  if (state === "empty") {
    return (
      <>
        <PageTitle eyebrow={eyebrow} title={title} />
        <EmptyState
          message={t("screens.s01.empty")}
          actionLabel={t("buttons.add")}
          onAction={onAddProject ?? (() => undefined)}
        />
      </>
    );
  }

  if (state === "error") {
    return (
      <>
        <PageTitle eyebrow={eyebrow} title={title} />
        <div className="rounded-k border border-k-grey bg-k-white p-s-8 text-center">
          <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
            >
              {t("common.retry")}
            </button>
          )}
        </div>
      </>
    );
  }

  const loading = state === "loading";
  const offline = state === "offline";
  // RULE (UI instructions §1): every KPI tile's comparator is the % of the
  // year elapsed, not just a comparison against the plan — spend is honest
  // about time, not only about budget.
  const comparator = data
    ? t("screens.s01.comparator", { value: formatPct(data.kpis.yearElapsedPct) })
    : undefined;

  const kpiTiles: Array<{ id: string; label: string; value: number | undefined }> = [
    { id: "approved", label: t("components.costBar.approved"), value: data?.kpis.approved },
    { id: "committed", label: t("components.costBar.committed"), value: data?.kpis.committed },
    { id: "spent", label: t("components.costBar.spent"), value: data?.kpis.spent },
    { id: "forecast", label: t("components.costBar.forecast"), value: data?.kpis.forecast },
  ];

  return (
    <>
      <PageTitle eyebrow={eyebrow} title={title} />
      {data && (
        <p className="mb-s-4 text-fs-14 text-k-text-muted">
          {t("screens.s01.asOf", { date: formatDate(data.asOf) })}
        </p>
      )}
      {offline && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {/* Row 1 — UI instructions §5: four KPI tiles, 2×2 on tablet, one row
          on desktop, stacked on phone. */}
      <div className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2 desktop:grid-cols-4">
        {kpiTiles.map((tile) => (
          <KpiTile
            key={tile.id}
            label={tile.label}
            value={loading || tile.value === undefined ? "" : formatEUR(tile.value)}
            comparator={loading ? undefined : comparator}
            state={loading ? "loading" : "default"}
          />
        ))}
      </div>

      {/* Row 2 — UI instructions §5: table (8/12) and exceptions (4/12) on
          desktop; on tablet and phone both stack with exceptions above the
          table so the head of estates sees what needs attention first. */}
      <div className="mt-s-6 grid grid-cols-1 gap-s-6 desktop:grid-cols-12">
        <div className="order-1 desktop:order-2 desktop:col-span-4">
          <ExceptionList items={data?.exceptions ?? []} loading={loading} />
        </div>
        <div className="order-2 desktop:order-1 desktop:col-span-8">
          <UnitTable
            units={data?.units ?? []}
            state={loading ? "loading" : offline ? "offline" : "default"}
            onRetry={onRetry}
          />
        </div>
      </div>
    </>
  );
}
