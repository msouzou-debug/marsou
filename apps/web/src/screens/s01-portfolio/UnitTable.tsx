"use client";

// S01 — R03

/**
 * UnitTable — the S01 unit table (UI instructions §5).
 *
 * | Prop      | Type                          | Notes                                              |
 * |-----------|-------------------------------|-------------------------------------------------------|
 * | units     | UnitRow[]                     | One row per org unit.                                  |
 * | state     | "default" \| "loading" \| "offline" | The screen resolves error/empty/noPermission before this ever mounts. |
 * | onRetry   | () => void                    | Passed through to the loading/error Table branches.    |
 *
 * Wraps the shared `Table` for the ungrouped view (sorting, sticky header,
 * density, column chooser, export and every state all come from there).
 * The "Ομαδοποίηση κατά Διεύθυνση" toggle switches to a hand-built grouped
 * table instead: `Table` has no concept of subheaders or subtotal rows, and
 * per the brief this screen may not change the component, so grouping is
 * worked around here rather than in `Table` (noted in the build summary).
 */

import { Fragment, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { UnitRow } from "@ecapital/shared";
import { directorateLabels } from "@ecapital/shared";
import type { Locale } from "@/i18n/config";
import { formatEUR, formatEURorDash, formatInt } from "@/lib/format";
import { RagChip } from "@/components/rag-chip";
import { Table, type TableColumn } from "@/components/table";
import { Sparkline } from "./Sparkline";

export type UnitTableState = "default" | "loading" | "offline";

export interface UnitTableProps {
  units: UnitRow[];
  state?: UnitTableState;
  onRetry?: () => void;
}

function unitName(unit: UnitRow["orgUnit"], locale: Locale): string {
  return locale === "en" ? unit.nameEn : unit.nameEl;
}

// S02: a unit row opens the project list filtered to that unit (UI
// instructions §5 "Rows link to S02 filtered by unit"). The unit switcher
// itself keeps linking to the area tree — only this row link changes.
function unitHref(unitId: string): string {
  return `/projects?unit=${encodeURIComponent(unitId)}`;
}

export function UnitTable({ units, state = "default", onRetry }: UnitTableProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [grouping, setGrouping] = useState(false); // RULE: grouping defaults off (UI instructions §5).

  // RULE (UI instructions §5): default sort is approved budget descending,
  // regardless of the order the data arrives in.
  const sortedUnits = useMemo(() => [...units].sort((a, b) => b.approved - a.approved), [units]);

  const openUnit = (unitId: string) => router.push(unitHref(unitId));

  // TODO(M6, R39): live-formula Excel export.
  const handleExport = () => undefined;

  const columns = useMemo<Array<TableColumn<UnitRow>>>(
    () => [
      {
        id: "unit",
        headerKey: "common.unit",
        accessor: (row) => unitName(row.orgUnit, locale),
        cell: (row) => (
          <Link
            href={unitHref(row.orgUnit.id)}
            className="text-k-blue underline-offset-2 hover:underline"
          >
            {unitName(row.orgUnit, locale)}
          </Link>
        ),
      },
      {
        id: "projects",
        headerKey: "screens.s01.unitTable.columns.projects",
        accessor: (row) => row.projectCount,
        cell: (row) => formatInt(row.projectCount),
        numeric: true,
      },
      {
        id: "approved",
        headerKey: "components.costBar.approved",
        accessor: (row) => row.approved,
        cell: (row) => formatEUR(row.approved),
        numeric: true,
      },
      {
        id: "spent",
        headerKey: "components.costBar.spent",
        // RULE (CAPEX-01 §7): null, never zero, until the SAP ingestion —
        // «—», not «€ 0» (same rule and same helper as the KPI tiles).
        accessor: (row) => row.spent,
        cell: (row) => formatEURorDash(row.spent),
        numeric: true,
      },
      {
        id: "progress",
        headerKey: "screens.s01.unitTable.columns.progress",
        accessor: () => 0,
        sortable: false,
        cell: (row) => (
          <Sparkline
            plan={row.sparkline.plan}
            spend={row.sparkline.spend}
            ariaLabel={t("screens.s01.unitTable.sparklineAria", {
              spend: formatEURorDash(row.spent),
              plan: formatEUR(row.approved),
            })}
          />
        ),
      },
      {
        id: "rag",
        headerKey: "screens.s01.unitTable.columns.rag",
        accessor: () => 0,
        sortable: false,
        cell: (row) => (
          <div className="flex items-center gap-s-2">
            <RagChip value="green" variant="count" count={row.rag.green} />
            <RagChip value="amber" variant="count" count={row.rag.amber} />
            <RagChip value="red" variant="count" count={row.rag.red} />
          </div>
        ),
      },
    ],
    [locale, t],
  );

  // RULE: row click, not only Enter, opens the unit's project list (UI
  // instructions §5). `Table` only wires Enter to `onRowOpen` (its keyboard
  // contract, §4), so a click is delegated here instead of changing it —
  // ignoring clicks on the name link itself so it does not navigate twice.
  const handleRowClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input")) return;
    const row = target.closest("tbody tr");
    if (!row?.parentElement) return;
    const index = Array.from(row.parentElement.children).indexOf(row);
    const unit = sortedUnits[index];
    if (unit) openUnit(unit.orgUnit.id);
  };

  const groupingToggle = (
    <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
      <input type="checkbox" checked={grouping} onChange={(event) => setGrouping(event.target.checked)} />
      {t("screens.s01.unitTable.groupByDirectorate")}
    </label>
  );

  if (grouping && (state === "default" || state === "offline")) {
    return (
      <GroupedUnitTable
        units={sortedUnits}
        readOnly={state === "offline"}
        groupingToggle={groupingToggle}
        onExport={handleExport}
        onOpenUnit={openUnit}
      />
    );
  }

  return (
    <div className="flex flex-col gap-s-2">
      <div className="rounded-k border border-k-grey bg-k-white px-s-3 py-s-2">{groupingToggle}</div>
      <div onClick={state === "default" || state === "offline" ? handleRowClick : undefined}>
        <Table<UnitRow>
          tableId="s01-unit-table"
          columns={columns}
          rows={sortedUnits}
          getRowId={(row) => row.orgUnit.id}
          captionKey="screens.s01.unitTable.caption"
          state={state}
          density="comfortable"
          skeletonRows={sortedUnits.length || 6}
          onExport={handleExport}
          onRowOpen={(row) => openUnit(row.orgUnit.id)}
          onRetry={onRetry}
        />
      </div>
    </div>
  );
}

interface GroupedUnitTableProps {
  units: UnitRow[];
  readOnly: boolean;
  groupingToggle: ReactNode;
  onExport: () => void;
  onOpenUnit: (unitId: string) => void;
}

// The grouped view Table cannot produce: directorate subheaders and a
// subtotal row per directorate (Έργα, Εγκεκριμένος, Δαπάνες), in the same
// visual language as the shared Table (comfortable rows, zebra, mono/
// right-aligned numerics) — UI instructions §5.
function GroupedUnitTable({ units, readOnly, groupingToggle, onExport, onOpenUnit }: GroupedUnitTableProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;

  const groups = useMemo(() => {
    const order: string[] = [];
    const byDirectorate = new Map<string, UnitRow[]>();
    for (const unit of units) {
      const key = unit.orgUnit.directorate;
      if (!byDirectorate.has(key)) {
        order.push(key);
        byDirectorate.set(key, []);
      }
      byDirectorate.get(key)!.push(unit);
    }
    return order.map((key) => ({ directorate: key, rows: byDirectorate.get(key)! }));
  }, [units]);

  return (
    <div className="rounded-k border border-k-grey bg-k-white">
      <div className="flex flex-wrap items-center justify-between gap-s-3 border-b border-k-grey p-s-3">
        {groupingToggle}
        {readOnly && <p className="text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}
        <button
          type="button"
          onClick={onExport}
          disabled={readOnly}
          title={readOnly ? t("components.table.offlineExport") : undefined}
          className="flex items-center gap-s-2 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep disabled:opacity-50"
        >
          {t("buttons.exportExcel")}
        </button>
      </div>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-fs-14">
          <caption className="sr-only">{t("screens.s01.unitTable.caption")}</caption>
          <thead className="sticky top-0 z-10 bg-k-white">
            <tr style={{ height: 48 }}>
              <th scope="col" className="border-b border-k-grey px-s-3 text-left font-bold text-k-blue-deep">
                {t("common.unit")}
              </th>
              <th scope="col" className="num border-b border-k-grey px-s-3 font-bold text-k-blue-deep">
                {t("screens.s01.unitTable.columns.projects")}
              </th>
              <th scope="col" className="num border-b border-k-grey px-s-3 font-bold text-k-blue-deep">
                {t("components.costBar.approved")}
              </th>
              <th scope="col" className="num border-b border-k-grey px-s-3 font-bold text-k-blue-deep">
                {t("components.costBar.spent")}
              </th>
              <th scope="col" className="border-b border-k-grey px-s-3 text-left font-bold text-k-blue-deep">
                {t("screens.s01.unitTable.columns.progress")}
              </th>
              <th scope="col" className="border-b border-k-grey px-s-3 text-left font-bold text-k-blue-deep">
                {t("screens.s01.unitTable.columns.rag")}
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const label = directorateLabels[group.directorate as keyof typeof directorateLabels];
              // RULE (CAPEX-01 §7): a subtotal of a ledger that is unknown
              // for any row in the group is itself unknown — null, not the
              // sum of whichever rows happen to have a figure.
              const subtotal = group.rows.reduce(
                (acc, row) => ({
                  projects: acc.projects + row.projectCount,
                  approved: acc.approved + row.approved,
                  spent: acc.spent === null || row.spent === null ? null : acc.spent + row.spent,
                }),
                { projects: 0, approved: 0, spent: 0 as number | null },
              );
              return (
                <Fragment key={group.directorate}>
                  <tr className="bg-k-surface">
                    <th
                      scope="rowgroup"
                      colSpan={6}
                      className="border-b border-k-grey px-s-3 py-s-2 text-left text-fs-14 font-bold text-k-blue-deep"
                    >
                      {locale === "en" ? label.en : label.el}
                    </th>
                  </tr>
                  {group.rows.map((row, index) => (
                    <tr
                      key={row.orgUnit.id}
                      tabIndex={0}
                      style={{ height: 48, backgroundColor: index % 2 === 1 ? "color-mix(in srgb, var(--k-grey) 40%, transparent)" : undefined }}
                      className="cursor-pointer"
                      onClick={() => onOpenUnit(row.orgUnit.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") onOpenUnit(row.orgUnit.id);
                      }}
                    >
                      <td className="border-b border-k-grey px-s-3">
                        <Link
                          href={unitHref(row.orgUnit.id)}
                          onClick={(event) => event.stopPropagation()}
                          className="text-k-blue underline-offset-2 hover:underline"
                        >
                          {unitName(row.orgUnit, locale)}
                        </Link>
                      </td>
                      <td className="num border-b border-k-grey px-s-3">{formatInt(row.projectCount)}</td>
                      <td className="num border-b border-k-grey px-s-3">{formatEUR(row.approved)}</td>
                      <td className="num border-b border-k-grey px-s-3">{formatEURorDash(row.spent)}</td>
                      <td className="border-b border-k-grey px-s-3">
                        <Sparkline
                          plan={row.sparkline.plan}
                          spend={row.sparkline.spend}
                          ariaLabel={t("screens.s01.unitTable.sparklineAria", {
                            spend: formatEURorDash(row.spent),
                            plan: formatEUR(row.approved),
                          })}
                        />
                      </td>
                      <td className="border-b border-k-grey px-s-3">
                        <div className="flex items-center gap-s-2">
                          <RagChip value="green" variant="count" count={row.rag.green} />
                          <RagChip value="amber" variant="count" count={row.rag.amber} />
                          <RagChip value="red" variant="count" count={row.rag.red} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className="border-b border-k-grey px-s-3">{t("screens.s01.unitTable.subtotal")}</td>
                    <td className="num border-b border-k-grey px-s-3">{formatInt(subtotal.projects)}</td>
                    <td className="num border-b border-k-grey px-s-3">{formatEUR(subtotal.approved)}</td>
                    <td className="num border-b border-k-grey px-s-3">{formatEURorDash(subtotal.spent)}</td>
                    <td className="border-b border-k-grey px-s-3" />
                    <td className="border-b border-k-grey px-s-3" />
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
