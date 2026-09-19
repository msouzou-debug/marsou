"use client";

// S11 (list) — R19–R25
//
/**
 * Permits — the pure S11 list screen body: Table + FilterBar, phone cards,
 * export (UI instructions §5 item 1, §4 Table/FilterBar).
 *
 * | Prop         | Type                    | Notes                                                        |
 * |--------------|-------------------------|------------------------------------------------------------------|
 * | data         | {items, total}?         | Ignored in `noPermission` \| `loading` \| `error`.                 |
 * | state        | PermitsScreenState      | The five states (UI instructions §6).                             |
 * | filters      | {status, system, unit}  | Current filter values — this component is fully controlled.       |
 * | orgUnits     | OrgUnit[]                | For the unit filter and the unit column.                          |
 * | onFilters    | (next) => void           | Fired on any filter change.                                       |
 * | onRetry      | () => void?              |                                                                    |
 * | noPermission | ReactNode                |                                                                    |
 * | now          | Date?                    | Injectable clock for the breach marker; defaults to `new Date()`. |
 *
 * RULE (§6.5): a permit whose `breachedAt` is set — or whose status is
 * BREACH — carries a red breach marker on its row, in both densities.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import type { OrgUnit, PermitListRow, PermitStatus, PermitSystem } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { FilterBar, type FilterItem } from "@/components/filter-bar";
import { IcraBadge } from "@/components/icra-badge";
import { Table, type TableColumn, type TableState } from "@/components/table";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/lib/format";
import { PermitTabs } from "./PermitTabs";
import { PermitCards } from "./PermitCards";

export type PermitsScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface PermitsFilters {
  status: PermitStatus[];
  system: PermitSystem | "";
  unit: string;
}

export interface PermitsProps {
  data?: { items: PermitListRow[]; total: number };
  state: PermitsScreenState;
  filters: PermitsFilters;
  orgUnits: OrgUnit[];
  onFilters: (next: PermitsFilters) => void;
  onRetry?: () => void;
  noPermission: ReactNode;
}

const STATUS_OPTIONS: PermitStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "CLINICAL_REVIEW",
  "APPROVED",
  "ACTIVE",
  "BREACH",
  "CLOSED",
  "REJECTED",
];
const SYSTEM_OPTIONS: PermitSystem[] = ["ELECTRICAL", "HVAC", "MEDICAL_GAS", "WATER", "FIRE", "IT", "STEAM", "DRAINAGE"];

export function Permits({ data, state, filters, orgUnits, onFilters, onRetry, noPermission }: PermitsProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();

  if (state === "noPermission") return <>{noPermission}</>;

  const unitNameById = new Map(orgUnits.map((u) => [u.id, locale === "en" ? u.nameEn : u.nameEl] as const));

  const filterItems: FilterItem[] = [
    ...filters.status.map((s) => ({ key: `status-${s}`, label: t("screens.s11.filters.status"), value: t(`permitStatus.${s}`) })),
    ...(filters.system ? [{ key: "system", label: t("screens.s11.filters.system"), value: t(`permitSystem.${filters.system}`) }] : []),
    ...(filters.unit ? [{ key: "unit", label: t("common.unit"), value: unitNameById.get(filters.unit) ?? filters.unit }] : []),
  ];

  function handleFilterBarChange(next: FilterItem[]) {
    const keys = new Set(next.map((f) => f.key));
    onFilters({
      status: STATUS_OPTIONS.filter((s) => keys.has(`status-${s}`)),
      system: keys.has("system") ? filters.system : "",
      unit: keys.has("unit") ? filters.unit : "",
    });
  }

  const columns: TableColumn<PermitListRow>[] = [
    {
      id: "ref",
      headerKey: "screens.s11.columns.ref",
      accessor: (row) => row.ref ?? "",
      cell: (row) => (
        <Link href={`/permits/${encodeURIComponent(row.id)}`} className="font-k-mono text-k-blue hover:underline">
          {row.ref ?? t("screens.s11.noRefYet")}
        </Link>
      ),
    },
    { id: "title", headerKey: "screens.s11.columns.title", accessor: (row) => row.titleEl },
    { id: "unit", headerKey: "common.unit", accessor: (row) => unitNameById.get(row.orgUnitId) ?? row.orgUnitNameEl },
    {
      id: "systems",
      headerKey: "screens.s11.columns.systems",
      accessor: (row) => row.systems.join(","),
      sortable: false,
      cell: (row) => (
        <span className="flex flex-wrap gap-s-1">
          {row.systems.map((s) => (
            <span key={s} className="rounded-k-chip bg-k-blue-bg px-s-2 py-[2px] text-fs-12 text-k-blue-deep">
              {t(`permitSystem.${s}`)}
            </span>
          ))}
        </span>
      ),
    },
    {
      id: "window",
      headerKey: "screens.s11.columns.window",
      accessor: (row) => row.plannedStart,
      numeric: true,
      cell: (row) => `${formatDate(row.plannedStart)} – ${formatDate(row.plannedEnd)}`,
    },
    {
      id: "icraClass",
      headerKey: "screens.s11.columns.icraClass",
      accessor: (row) => row.icraClass ?? "",
      sortable: false,
      cell: (row) => (row.icraClass ? <IcraBadge icraClass={row.icraClass} size="list" /> : t("common.notAvailable")),
    },
    {
      id: "status",
      headerKey: "common.status",
      accessor: (row) => row.status,
      cell: (row) => (
        <span className="flex items-center gap-s-1">
          {/* RULE (§6.5): a breach marker sits on the row regardless of density. */}
          {(row.status === "BREACH" || row.breachedAt) && (
            <TriangleAlert size={20} strokeWidth={1.5} aria-hidden="true" className="text-k-red" />
          )}
          {t(`permitStatus.${row.status}`)}
        </span>
      ),
    },
    {
      id: "pendingApprovals",
      headerKey: "screens.s11.columns.pendingApprovals",
      accessor: (row) => row.pendingApprovals,
      numeric: true,
    },
  ];

  const tableState: TableState = state === "default" ? "default" : state;
  const showCards = (state === "default" || state === "offline") && !!data;

  return (
    <>
      <PageTitle
        eyebrow={t("nav.shutdowns")}
        title={t("screens.s11.title")}
        tabs={<PermitTabs active="permits" />}
        action={
          state !== "offline" ? (
            <Link href="/permits/new" className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k">
              {t("buttons.add")}
            </Link>
          ) : undefined
        }
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <div className="mb-s-4 flex flex-col gap-s-3">
        <div className="flex flex-wrap items-center gap-s-3">
          <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
            {t("screens.s11.filters.system")}
            <select
              value={filters.system}
              onChange={(e) => onFilters({ ...filters, system: e.target.value as PermitSystem | "" })}
              className="rounded-k border border-k-grey p-s-2 text-fs-14"
            >
              <option value="">{t("screens.s11.filters.all")}</option>
              {SYSTEM_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`permitSystem.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
            {t("common.unit")}
            <select
              value={filters.unit}
              onChange={(e) => onFilters({ ...filters, unit: e.target.value })}
              className="rounded-k border border-k-grey p-s-2 text-fs-14"
            >
              <option value="">{t("screens.s11.filters.all")}</option>
              {orgUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitNameById.get(u.id)}
                </option>
              ))}
            </select>
          </label>
          {STATUS_OPTIONS.map((s) => (
            <label key={s} className="flex items-center gap-s-1 text-fs-14 text-k-text">
              <input
                type="checkbox"
                checked={filters.status.includes(s)}
                onChange={(e) =>
                  onFilters({
                    ...filters,
                    status: e.target.checked ? [...filters.status, s] : filters.status.filter((x) => x !== s),
                  })
                }
              />
              {t(`permitStatus.${s}`)}
            </label>
          ))}
        </div>
        <FilterBar filters={filterItems} onChange={handleFilterBarChange} savedViews={[]} onSaveView={() => undefined} />
      </div>

      {showCards && (
        <div className="tablet:hidden">
          <PermitCards items={data.items} unitNameById={unitNameById} />
        </div>
      )}
      <div className={showCards ? "hidden tablet:block" : undefined}>
        <Table<PermitListRow>
          tableId="s11-permits"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          captionKey="screens.s11.caption"
          state={tableState}
          density="comfortable"
          onExport={() => undefined}
          onRetry={onRetry}
          emptyState={{
            messageKey: "screens.s11.empty",
            actionLabelKey: "buttons.add",
            onAction: state !== "offline" ? () => router.push("/permits/new") : undefined,
          }}
        />
      </div>
    </>
  );
}
