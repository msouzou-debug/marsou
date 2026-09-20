"use client";

// S16a — R26–R30, R45
//
/**
 * Assets — the pure S16a list screen body: Table + FilterBar, phone cards,
 * export, «Προσθήκη» and «Εκτύπωση ετικετών» (M4 build brief item 1; UI
 * instructions §4 Table/FilterBar). Same Screen/pure split as
 * `s11-permits/Permits.tsx`, whose header comment this follows: filters are
 * kept in this screen's own state rather than the URL — the register has a
 * handful of simple facets, the same call S11 makes for the same reason.
 *
 * | Prop         | Type                | Notes                                                        |
 * |--------------|---------------------|------------------------------------------------------------------|
 * | data         | {items, total}?     | Ignored in `noPermission` \| `loading` \| `error`.                 |
 * | state        | AssetsScreenState   | The five states (UI instructions §6).                             |
 * | filters      | AssetsFilters       | Current filter values — this component is fully controlled.       |
 * | orgUnits     | OrgUnit[]           | For the unit filter and the unit column.                          |
 * | onFilters    | (next) => void      | Fired on any filter change.                                       |
 * | onRetry      | () => void?         |                                                                    |
 * | canWrite     | boolean             | Hides «Προσθήκη» for a role `canWriteAssets` refuses (`@/auth/roles`). |
 * | noPermission | ReactNode           |                                                                    |
 *
 * RULE (build brief item 1): rows sort by tag by default; a «Προτεραιότητα»
 * column sorts by the API's own `priorityRank` (criticality × condition,
 * computed server-side so every list agrees — contract `AssetListRow`). The
 * column is one more sortable `Table` header, not a second query mode: the
 * whole page already fetches in one call (`pageSize: 200`, an org unit's own
 * register is short) and `Table` already sorts whatever page it holds
 * client-side (`getSortedRowModel`), the same way every other column does.
 *
 * RULE (build brief item 1): «Εκτύπωση ετικετών» opens the label sheet for
 * the selected rows (`Table selectable`) in a new tab; disabled — with the
 * reason in its `title` — until at least one row is selected, never hidden,
 * so the control has a stable position (UI instructions §6 "Offline" applies
 * the same "disable with a reason" idea to any write/action control here).
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Tags } from "lucide-react";
import type { AssetClass, AssetListRow, AssetStatus, Condition, OrgUnit } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { ConditionChip } from "@/components/condition-chip";
import { CriticalityChip } from "@/components/criticality-chip";
import { FilterBar, type FilterItem } from "@/components/filter-bar";
import { Table, type TableColumn, type TableState } from "@/components/table";
import type { Locale } from "@/i18n/config";
import { formatDate, formatInt } from "@/lib/format";
import { AssetCards } from "./AssetCards";
import { AssetTabs } from "./AssetTabs";

export type AssetsScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface AssetsFilters {
  unit: string;
  areaId: string;
  assetClass: AssetClass | "";
  criticality: number | 0;
  condition: Condition | "";
  status: AssetStatus | "";
  q: string;
}

export interface AssetsProps {
  data?: { items: AssetListRow[]; total: number };
  state: AssetsScreenState;
  filters: AssetsFilters;
  orgUnits: OrgUnit[];
  onFilters: (next: AssetsFilters) => void;
  onRetry?: () => void;
  canWrite: boolean;
  canViewForecast: boolean;
  noPermission: ReactNode;
}

const CLASS_OPTIONS: AssetClass[] = [
  "BUILDING_FABRIC",
  "HVAC",
  "ELECTRICAL",
  "MEDICAL_GAS",
  "WATER",
  "FIRE",
  "LIFT",
  "BIOMEDICAL",
  "IT",
  "OTHER",
];
const CRITICALITY_OPTIONS = [1, 2, 3, 4, 5] as const;
const CONDITION_OPTIONS: Condition[] = ["A", "B", "C", "D", "E"];
const STATUS_OPTIONS: AssetStatus[] = ["IN_SERVICE", "OUT_OF_SERVICE", "DISPOSED", "PLANNED"];

export function Assets({ data, state, filters, orgUnits, onFilters, onRetry, canWrite, canViewForecast, noPermission }: AssetsProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  if (state === "noPermission") return <>{noPermission}</>;

  const unitNameById = new Map(orgUnits.map((u) => [u.id, locale === "en" ? u.nameEn : u.nameEl] as const));

  const filterItems: FilterItem[] = [
    ...(filters.unit ? [{ key: "unit", label: t("common.unit"), value: unitNameById.get(filters.unit) ?? filters.unit }] : []),
    // RULE (build brief item 7): S16's own area row links here with `areaId`
    // set — the chip has no area-name lookup of its own, so it shows the raw
    // id rather than guessing a label.
    ...(filters.areaId ? [{ key: "area", label: t("components.asset-breadcrumb.levels.room"), value: filters.areaId }] : []),
    ...(filters.assetClass
      ? [{ key: "class", label: t("screens.s16a.filters.class"), value: t(`assetClass.${filters.assetClass}`) }]
      : []),
    ...(filters.criticality
      ? [{ key: "criticality", label: t("screens.s16a.filters.criticality"), value: String(filters.criticality) }]
      : []),
    ...(filters.condition
      ? [{ key: "condition", label: t("screens.s16a.filters.condition"), value: filters.condition }]
      : []),
    ...(filters.status ? [{ key: "status", label: t("common.status"), value: t(`assetStatus.${filters.status}`) }] : []),
    ...(filters.q.trim() ? [{ key: "q", label: t("common.search"), value: filters.q.trim() }] : []),
  ];

  function handleFilterBarChange(next: FilterItem[]) {
    const keys = new Set(next.map((f) => f.key));
    onFilters({
      unit: keys.has("unit") ? filters.unit : "",
      areaId: keys.has("area") ? filters.areaId : "",
      assetClass: keys.has("class") ? filters.assetClass : "",
      criticality: keys.has("criticality") ? filters.criticality : 0,
      condition: keys.has("condition") ? filters.condition : "",
      status: keys.has("status") ? filters.status : "",
      q: keys.has("q") ? filters.q : "",
    });
  }

  const columns: TableColumn<AssetListRow>[] = [
    {
      id: "tag",
      headerKey: "screens.s16a.columns.tag",
      accessor: (row) => row.tag,
      cell: (row) => (
        <Link href={`/assets/${encodeURIComponent(row.id)}`} className="font-k-mono text-k-blue hover:underline">
          {row.tag}
        </Link>
      ),
    },
    { id: "name", headerKey: "screens.s16a.columns.name", accessor: (row) => row.nameEl },
    {
      id: "class",
      headerKey: "screens.s16a.columns.class",
      accessor: (row) => row.assetClass,
      cell: (row) => t(`assetClass.${row.assetClass}`),
    },
    {
      id: "area",
      headerKey: "screens.s16a.columns.area",
      accessor: (row) => row.areaNameEl ?? "",
      cell: (row) => row.areaNameEl ?? t("common.notAvailable"),
    },
    {
      id: "criticality",
      headerKey: "screens.s16a.columns.criticality",
      accessor: (row) => row.criticality,
      numeric: true,
      cell: (row) => <CriticalityChip value={row.criticality as 1 | 2 | 3 | 4 | 5} />,
    },
    {
      id: "condition",
      headerKey: "screens.s16a.columns.condition",
      accessor: (row) => row.condition ?? "",
      cell: (row) => <ConditionChip value={row.condition} />,
    },
    {
      id: "warrantyEnd",
      headerKey: "screens.s16a.columns.warrantyEnd",
      accessor: (row) => row.warrantyEnd ?? "",
      numeric: true,
      cell: (row) => (row.warrantyEnd ? formatDate(row.warrantyEnd) : t("common.notAvailable")),
    },
    {
      id: "replacementYear",
      headerKey: "screens.s16a.columns.replacementYear",
      accessor: (row) => row.replacementYear ?? "",
      numeric: true,
      cell: (row) => (row.replacementYear === null ? t("common.notAvailable") : formatInt(row.replacementYear)),
    },
    {
      id: "status",
      headerKey: "common.status",
      accessor: (row) => row.status,
      cell: (row) => t(`assetStatus.${row.status}`),
    },
    {
      id: "priority",
      // RULE (build brief item 1): the «Προτεραιότητα» sort, over the API's
      // own `priorityRank` — nulls (no rank computed) sort after every
      // ranked row, never first.
      headerKey: "screens.s16a.columns.priority",
      accessor: (row) => row.priorityRank ?? Number.POSITIVE_INFINITY,
      numeric: true,
      cell: (row) => (row.priorityRank === null ? t("common.notAvailable") : formatInt(row.priorityRank)),
    },
  ];

  const tableState: TableState = state === "default" ? "default" : state;
  const showCards = (state === "default" || state === "offline") && !!data;

  const labelsHref = `/assets/labels?ids=${selectedIds.map(encodeURIComponent).join(",")}`;

  return (
    <>
      <PageTitle
        eyebrow={t("nav.assets")}
        title={t("screens.s16a.title")}
        tabs={<AssetTabs active="register" canViewForecast={canViewForecast} />}
        action={
          state !== "offline" ? (
            <div className="flex flex-wrap items-center gap-s-3">
              {selectedIds.length > 0 ? (
                <a
                  href={labelsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-s-2 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
                >
                  <Tags size={20} strokeWidth={1.5} aria-hidden="true" />
                  {t("screens.s16a.printLabels")}
                </a>
              ) : (
                <span
                  title={t("screens.s16a.printLabels")}
                  className="flex cursor-not-allowed items-center gap-s-2 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-text-muted opacity-50"
                >
                  <Tags size={20} strokeWidth={1.5} aria-hidden="true" />
                  {t("screens.s16a.printLabels")}
                </span>
              )}
              {canWrite && (
                <Link href="/assets/new" className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k">
                  {t("buttons.add")}
                </Link>
              )}
            </div>
          ) : undefined
        }
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <div className="mb-s-4 flex flex-col gap-s-3">
        <div className="flex flex-wrap items-center gap-s-3">
          <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
            {t("common.unit")}
            <select
              value={filters.unit}
              onChange={(e) => onFilters({ ...filters, unit: e.target.value })}
              className="rounded-k border border-k-grey p-s-2 text-fs-14"
            >
              <option value="">{t("screens.s16a.filters.all")}</option>
              {orgUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitNameById.get(u.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
            {t("screens.s16a.filters.class")}
            <select
              value={filters.assetClass}
              onChange={(e) => onFilters({ ...filters, assetClass: e.target.value as AssetClass | "" })}
              className="rounded-k border border-k-grey p-s-2 text-fs-14"
            >
              <option value="">{t("screens.s16a.filters.all")}</option>
              {CLASS_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {t(`assetClass.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
            {t("screens.s16a.filters.criticality")}
            <select
              value={filters.criticality || ""}
              onChange={(e) => onFilters({ ...filters, criticality: e.target.value ? Number(e.target.value) : 0 })}
              className="rounded-k border border-k-grey p-s-2 text-fs-14"
            >
              <option value="">{t("screens.s16a.filters.all")}</option>
              {CRITICALITY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
            {t("screens.s16a.filters.condition")}
            <select
              value={filters.condition}
              onChange={(e) => onFilters({ ...filters, condition: e.target.value as Condition | "" })}
              className="rounded-k border border-k-grey p-s-2 text-fs-14"
            >
              <option value="">{t("screens.s16a.filters.all")}</option>
              {CONDITION_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
            {t("common.status")}
            <select
              value={filters.status}
              onChange={(e) => onFilters({ ...filters, status: e.target.value as AssetStatus | "" })}
              className="rounded-k border border-k-grey p-s-2 text-fs-14"
            >
              <option value="">{t("screens.s16a.filters.all")}</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`assetStatus.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
            {t("screens.s16a.searchLabel")}
            <input
              type="search"
              value={filters.q}
              onChange={(e) => onFilters({ ...filters, q: e.target.value })}
              placeholder={t("screens.s16a.searchPlaceholder")}
              className="rounded-k border border-k-grey p-s-2 text-fs-14"
            />
          </label>
        </div>
        <FilterBar filters={filterItems} onChange={handleFilterBarChange} savedViews={[]} onSaveView={() => undefined} />
      </div>

      {showCards && (
        <div className="tablet:hidden">
          <AssetCards items={data.items} />
        </div>
      )}
      <div className={showCards ? "hidden tablet:block" : undefined}>
        <Table<AssetListRow>
          tableId="s16a-assets"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          captionKey="screens.s16a.caption"
          state={tableState}
          density="dense"
          selectable
          onSelectionChange={setSelectedIds}
          onExport={() => undefined}
          onRetry={onRetry}
          emptyState={{
            messageKey: "screens.s16a.empty",
            actionLabelKey: "buttons.add",
            onAction: state !== "offline" && canWrite ? () => router.push("/assets/new") : undefined,
          }}
        />
      </div>
    </>
  );
}
