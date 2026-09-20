"use client";

// S17c — R30 (M4 build brief item 6)
//
/**
 * Forecast — the pure S17c replacement-forecast screen body: a year-range
 * picker (default this year to +10), a table by unit and year with a totals
 * footer, export, and a `ForecastChart` of estimated cost per year.
 *
 * A hand-rolled table, not the shared `Table` (`@/components/table`): this
 * screen's own "grouped rows plus a totals footer" shape is not something
 * the generic component has a slot for (its header comment lists column
 * chooser, inline edit, row selection — no footer row), so this follows the
 * export-button rule (UI instructions §0.4/§4: top right, always rendered,
 * disabled while loading) by hand instead of forcing the data through a
 * component built for a different shape.
 *
 * | Prop      | Type                    | Notes                                                    |
 * |-----------|-------------------------|-----------------------------------------------------------|
 * | rows      | ReplacementForecastRow[]? | Ignored in `noPermission` \| `loading` \| `error`.        |
 * | state     | ForecastScreenState     | The five states (UI instructions §6).                      |
 * | from/to   | number                  | The picked year range.                                     |
 * | onRangeChange | (from, to) => void  |                                                             |
 * | unit      | string                  | Optional org-unit filter, `""` = every visible unit.       |
 * | orgUnits  | OrgUnit[]               |                                                             |
 * | onUnitChange | (unit) => void       |                                                             |
 * | onRetry   | () => void?             |                                                             |
 * | noPermission | ReactNode            |                                                             |
 */
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { FileSpreadsheet } from "lucide-react";
import type { OrgUnit, ReplacementForecastRow } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { ForecastChart } from "@/components/forecast-chart";
import type { Locale } from "@/i18n/config";
import { formatEUR, formatInt } from "@/lib/format";
import { AssetTabs } from "../s16a-assets/AssetTabs";

export type ForecastScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface ForecastProps {
  rows?: ReplacementForecastRow[];
  state: ForecastScreenState;
  from: number;
  to: number;
  onRangeChange: (from: number, to: number) => void;
  unit: string;
  orgUnits: OrgUnit[];
  onUnitChange: (unit: string) => void;
  onRetry?: () => void;
  noPermission: ReactNode;
}

export function Forecast({ rows, state, from, to, onRangeChange, unit, orgUnits, onUnitChange, onRetry, noPermission }: ForecastProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;

  if (state === "noPermission") return <>{noPermission}</>;

  const unitNameById = new Map(orgUnits.map((u) => [u.id, locale === "en" ? u.nameEn : u.nameEl] as const));
  const sorted = [...(rows ?? [])].sort((a, b) => (a.orgUnitNameEl === b.orgUnitNameEl ? a.year - b.year : a.orgUnitNameEl.localeCompare(b.orgUnitNameEl)));

  const totals = sorted.reduce(
    (acc, row) => ({
      assets: acc.assets + row.assets,
      estimatedCost: acc.estimatedCost + row.estimatedCost,
      criticalAssets: acc.criticalAssets + row.criticalAssets,
    }),
    { assets: 0, estimatedCost: 0, criticalAssets: 0 },
  );

  const chartRows = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i).map((year) => ({
    year,
    value: sorted.filter((r) => r.year === year).reduce((sum, r) => sum + r.estimatedCost, 0),
  }));

  const showTable = state === "default" || state === "offline";

  return (
    <>
      <PageTitle eyebrow={t("nav.assets")} title={t("screens.s17c.title")} tabs={<AssetTabs active="forecast" canViewForecast={true} />} />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <div className="mb-s-5 flex flex-wrap items-end gap-s-4">
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
          {t("screens.s17c.yearFrom")}
          <input
            type="number"
            value={from}
            onChange={(e) => onRangeChange(Number(e.target.value), to)}
            className="num h-11 w-[120px] rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
          />
        </label>
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
          {t("screens.s17c.yearTo")}
          <input
            type="number"
            value={to}
            onChange={(e) => onRangeChange(from, Number(e.target.value))}
            className="num h-11 w-[120px] rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
          />
        </label>
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
          {t("common.unit")}
          <select value={unit} onChange={(e) => onUnitChange(e.target.value)} className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink">
            <option value="">{t("common.allUnits")}</option>
            {orgUnits.map((u) => (
              <option key={u.id} value={u.id}>{unitNameById.get(u.id)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-s-6">
        <ForecastChart rows={chartRows} state={state === "loading" ? "loading" : state === "error" ? "error" : "default"} />
      </div>

      <div className="rounded-k border border-k-grey bg-k-white">
        <div className="flex items-center justify-between gap-s-3 border-b border-k-grey p-s-3">
          <p className="text-fs-14 text-k-text">{t("screens.s17c.caption")}</p>
          <button
            type="button"
            onClick={() => undefined}
            disabled={state === "loading"}
            className="flex items-center gap-s-2 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep disabled:opacity-50"
          >
            <FileSpreadsheet size={24} strokeWidth={1.5} aria-hidden="true" />
            {t("buttons.exportExcel")}
          </button>
        </div>

        {state === "error" ? (
          <div className="p-s-8 text-center">
            <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
                {t("common.retry")}
              </button>
            )}
          </div>
        ) : state === "empty" || (showTable && sorted.length === 0) ? (
          <p className="mx-auto max-w-[400px] p-s-8 text-center text-fs-16 text-k-ink">{t("screens.s17c.empty")}</p>
        ) : state === "loading" ? (
          <div aria-busy="true" className="grid gap-s-2 p-s-4">
            {[0, 1, 2].map((i) => (
              <span key={i} className="block h-s-4 rounded-k-chip bg-k-grey" />
            ))}
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full border-collapse text-fs-14">
              <caption className="sr-only">{t("screens.s17c.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col" className="border-b border-k-grey px-s-2 py-s-2 text-left font-bold text-k-blue-deep">{t("screens.s17c.columns.unit")}</th>
                  <th scope="col" className="num border-b border-k-grey px-s-2 py-s-2 font-bold text-k-blue-deep">{t("screens.s17c.columns.year")}</th>
                  <th scope="col" className="num border-b border-k-grey px-s-2 py-s-2 font-bold text-k-blue-deep">{t("screens.s17c.columns.assets")}</th>
                  <th scope="col" className="num border-b border-k-grey px-s-2 py-s-2 font-bold text-k-blue-deep">{t("screens.s17c.columns.estimatedCost")}</th>
                  <th scope="col" className="num border-b border-k-grey px-s-2 py-s-2 font-bold text-k-blue-deep">{t("screens.s17c.columns.criticalAssets")}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, index) => (
                  <tr key={`${row.orgUnitId}-${row.year}`} style={{ backgroundColor: index % 2 === 1 ? "color-mix(in srgb, var(--k-grey) 40%, transparent)" : undefined }}>
                    <td className="px-s-2 py-s-2">{unitNameById.get(row.orgUnitId) ?? row.orgUnitNameEl}</td>
                    <td className="num px-s-2 py-s-2">{row.year}</td>
                    <td className="num px-s-2 py-s-2">{formatInt(row.assets)}</td>
                    <td className="num px-s-2 py-s-2">{formatEUR(row.estimatedCost)}</td>
                    <td className="num px-s-2 py-s-2">{formatInt(row.criticalAssets)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-k-grey font-bold">
                  <td className="px-s-2 py-s-2">{t("screens.s17c.totals")}</td>
                  <td className="num px-s-2 py-s-2" />
                  <td className="num px-s-2 py-s-2">{formatInt(totals.assets)}</td>
                  <td className="num px-s-2 py-s-2">{formatEUR(totals.estimatedCost)}</td>
                  <td className="num px-s-2 py-s-2">{formatInt(totals.criticalAssets)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
