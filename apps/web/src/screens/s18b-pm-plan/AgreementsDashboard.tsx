"use client";

// S18b «Προληπτική συντήρηση» — the agreements dashboard (owner UAT)
//
/**
 * AgreementsDashboard — the pure body of S18b's default view: five KPI
 * tiles, the filters and one table of every maintenance agreement the
 * caller may see. The Screen owns the URL, the read and the navigation.
 *
 * | Prop          | Type                                | Notes                                               |
 * |---------------|-------------------------------------|-----------------------------------------------------|
 * | data          | MaintenanceAgreementList?           | GET /maintenance/agreements with the URL's filters. |
 * | state         | AgreementsDashboardState            | Six states.                                         |
 * | query         | MaintenanceAgreementQuery           | Parsed from the URL; fully controlled.              |
 * | orgUnits      | OrgUnit[]                           | The hospital filter's options and the unit names.   |
 * | onQueryChange | (next) => void                      | The Screen writes it to the URL.                    |
 * | onOpen        | (row) => void                       | Enter on a row: the agreement's per-unit view.      |
 * | tabs          | ReactNode?                          | PlanTabs, under the title.                          |
 *
 * RULE: the tiles count the rows the filters left, so a hospital or an
 * equipment type narrows the tiles with the table.
 * RULE: «Equipment type» is the register class an active catalogue line of
 * the agreement maps to; the agreement carries no other equipment field.
 * RULE: the value tile adds the agreements still in force that have a value.
 * The data holds each agreement's whole value, not an annual one.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AgreementExpiryBand, AssetClass, type MaintenanceAgreementList, type MaintenanceAgreementQuery, type MaintenanceAgreementRow, type OrgUnit } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { FilterBar, type FilterItem } from "@/components/filter-bar";
import { KpiTile } from "@/components/kpi-tile";
import { Table, type TableColumn, type TableState } from "@/components/table";
import type { Locale } from "@/i18n/config";
import { formatDate, formatEUR, formatEURorDash, formatInt } from "@/lib/format";
import { FacetFilter } from "@/screens/s02-projects/FacetFilter";
import {
  agreementDetailHref,
  agreementsQueryToFilterItems,
  filterItemsToAgreementsQuery,
  toggleFacet,
} from "./agreements-query";
import { ExpiryChip } from "./ExpiryChip";

export type AgreementsDashboardState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface AgreementsDashboardProps {
  data?: MaintenanceAgreementList;
  state: AgreementsDashboardState;
  query: MaintenanceAgreementQuery;
  orgUnits: OrgUnit[];
  onQueryChange: (next: MaintenanceAgreementQuery) => void;
  onOpen: (row: MaintenanceAgreementRow) => void;
  onRetry?: () => void;
  noPermission: ReactNode;
  tabs?: ReactNode;
}

const BANDS = AgreementExpiryBand.options;

export function AgreementsDashboard(props: AgreementsDashboardProps) {
  const { data, state, query, orgUnits, onQueryChange, onOpen, onRetry, noPermission, tabs } = props;
  const t = useTranslations();
  const td = useTranslations("screens.s18plan.dashboard");
  const locale = useLocale() as Locale;

  const unitName = useMemo(() => {
    const names = new Map(orgUnits.map((u) => [u.id, locale === "en" ? u.nameEn : u.nameEl] as const));
    return (id: string) => names.get(id) ?? id;
  }, [orgUnits, locale]);
  const contractors = useMemo(() => data?.contractors ?? [], [data]);
  const contractorName = useMemo(() => {
    const names = new Map(contractors.map((c) => [c.id, c.name] as const));
    return (id: string) => names.get(id) ?? id;
  }, [contractors]);

  // The search box writes to the URL 400 ms after the last keystroke; a chip
  // removed from outside resyncs the draft (S02's pattern).
  const [draft, setDraft] = useState(query.q);
  const [syncedQ, setSyncedQ] = useState(query.q);
  if (query.q !== syncedQ) {
    setSyncedQ(query.q);
    setDraft(query.q);
  }
  useEffect(() => {
    if (draft === query.q) return;
    const timeout = setTimeout(() => onQueryChange({ ...query, q: draft }), 400);
    return () => clearTimeout(timeout);
  }, [draft, query, onQueryChange]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const kpi = useMemo(() => {
    const inForce = items.filter((r) => r.expiryBand !== "EXPIRED");
    return {
      total: items.length,
      active: inForce.length,
      expiring: items.filter((r) => r.expiryBand === "EXPIRING").length,
      expired: items.filter((r) => r.expiryBand === "EXPIRED").length,
      value: inForce.reduce((sum, r) => sum + (r.contractValue ?? 0), 0),
      noValue: inForce.filter((r) => r.contractValue === null).length,
      pmDue: items.reduce((sum, r) => sum + r.pmDueThisMonth, 0),
      pmOverdue: items.reduce((sum, r) => sum + r.pmOverdue, 0),
    };
  }, [items]);

  if (state === "noPermission") return <>{noPermission}</>;

  const filterItems: FilterItem[] = agreementsQueryToFilterItems(query, { unitName, contractorName }, t);
  const tileState = state === "loading" ? "loading" : state === "error" ? "error" : "default";

  const unitOptions = orgUnits.map((u) => ({ value: u.id, label: unitName(u.id) })).sort((a, b) => a.label.localeCompare(b.label, locale));
  const classOptions = AssetClass.options.map((c) => ({ value: c, label: t(`assetClass.${c}`) }));
  const contractorOptions = contractors.map((c) => ({ value: c.id, label: c.name }));
  const bandOptions = BANDS.map((b) => ({ value: b, label: td(`band.${b}`) }));

  const columns: TableColumn<MaintenanceAgreementRow>[] = [
    { id: "unit", headerKey: "screens.s18plan.dashboard.columns.unit", accessor: (row) => unitName(row.orgUnitId) },
    {
      id: "ref",
      headerKey: "screens.s18plan.dashboard.columns.ref",
      accessor: (row) => row.ref,
      cell: (row) => (
        <span className="flex flex-col">
          <Link href={agreementDetailHref(row)} className="font-k-mono text-k-blue hover:underline">
            {row.ref}
          </Link>
          <span className="text-fs-12 text-k-text">{row.titleEl}</span>
        </span>
      ),
    },
    { id: "contractor", headerKey: "screens.s18plan.dashboard.columns.contractor", accessor: (row) => row.contractorName },
    {
      id: "classes",
      headerKey: "screens.s18plan.dashboard.columns.classes",
      accessor: (row) => row.assetClasses.map((c) => t(`assetClass.${c}`)).join(", "),
      cell: (row) => (row.assetClasses.length ? row.assetClasses.map((c) => t(`assetClass.${c}`)).join(", ") : t("common.notAvailable")),
    },
    { id: "systems", headerKey: "screens.s18plan.dashboard.columns.systems", accessor: (row) => row.systemsCount, numeric: true, cell: (row) => formatInt(row.systemsCount) },
    { id: "start", headerKey: "screens.s18plan.dashboard.columns.start", accessor: (row) => row.startDate, numeric: true, cell: (row) => formatDate(row.startDate) },
    {
      id: "end",
      headerKey: "screens.s18plan.dashboard.columns.end",
      accessor: (row) => row.endDate ?? "9999-12-31",
      numeric: true,
      cell: (row) => (row.endDate ? formatDate(row.endDate) : t("screens.s18plan.agreement.open")),
    },
    {
      id: "days",
      headerKey: "screens.s18plan.dashboard.columns.days",
      accessor: (row) => row.daysToExpiry ?? Number.MAX_SAFE_INTEGER,
      numeric: true,
      cell: (row) => (row.daysToExpiry === null ? t("common.notAvailable") : formatInt(row.daysToExpiry)),
    },
    { id: "band", headerKey: "screens.s18plan.dashboard.columns.band", accessor: (row) => BANDS.indexOf(row.expiryBand), cell: (row) => <ExpiryChip band={row.expiryBand} /> },
    { id: "value", headerKey: "screens.s18plan.dashboard.columns.value", accessor: (row) => row.contractValue ?? -1, numeric: true, cell: (row) => formatEURorDash(row.contractValue) },
    { id: "assets", headerKey: "screens.s18plan.dashboard.columns.assets", accessor: (row) => row.assetsCount, numeric: true, cell: (row) => formatInt(row.assetsCount) },
    { id: "schedules", headerKey: "screens.s18plan.dashboard.columns.schedules", accessor: (row) => row.pmSchedulesCount, numeric: true, cell: (row) => formatInt(row.pmSchedulesCount) },
    { id: "pmDue", headerKey: "screens.s18plan.dashboard.columns.pmDue", accessor: (row) => row.pmDueThisMonth, numeric: true, cell: (row) => formatInt(row.pmDueThisMonth) },
    { id: "pmOverdue", headerKey: "screens.s18plan.dashboard.columns.pmOverdue", accessor: (row) => row.pmOverdue, numeric: true, cell: (row) => formatInt(row.pmOverdue) },
    {
      id: "status",
      headerKey: "common.status",
      accessor: (row) => row.status,
      cell: (row) => t(row.status === "ACTIVE" ? "screens.s18plan.agreement.statusActive" : "screens.s18plan.agreement.statusEnded"),
    },
  ];

  const tableState: TableState = state;

  return (
    <>
      <PageTitle
        eyebrow={
          <Link href="/maintenance" className="hover:underline">
            {t("nav.maintenance")}
          </Link>
        }
        title={t("screens.s18plan.title")}
      />
      {tabs}
      <p className="mb-s-5 max-w-[720px] text-fs-16 text-k-text">{td("intro")}</p>
      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <section aria-label={td("kpiLabel")} className="mb-s-6 grid grid-cols-1 gap-s-4 tablet:grid-cols-3 desktop:grid-cols-5">
        <KpiTile label={td("kpi.active")} value={formatInt(kpi.active)} comparator={td("kpi.activeOf", { total: formatInt(kpi.total) })} state={tileState} onRetry={onRetry} />
        <KpiTile label={td("kpi.expiring")} value={formatInt(kpi.expiring)} comparator={td("kpi.expiringHint")} state={tileState} onRetry={onRetry} />
        <KpiTile label={td("kpi.expired")} value={formatInt(kpi.expired)} state={tileState} onRetry={onRetry} />
        <KpiTile
          label={td("kpi.value")}
          value={formatEUR(kpi.value)}
          comparator={kpi.noValue ? td("kpi.noValue", { count: kpi.noValue }) : undefined}
          state={tileState}
          onRetry={onRetry}
        />
        <KpiTile label={td("kpi.pmDue")} value={formatInt(kpi.pmDue)} comparator={td("kpi.pmOverdue", { count: formatInt(kpi.pmOverdue) })} state={tileState} onRetry={onRetry} />
      </section>

      <div className="mb-s-4 flex flex-col gap-s-3">
        <div className="flex flex-wrap items-end gap-s-3">
          <label className="flex min-w-[240px] flex-col gap-s-1 text-fs-14 text-k-text">
            {t("common.search")}
            <input
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={td("searchPlaceholder")}
              className="min-h-[44px] rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
            />
          </label>
          <FacetFilter label={td("filters.unit")} options={unitOptions} selected={query.orgUnitId} onToggle={(v) => onQueryChange(toggleFacet(query, "orgUnitId", v))} />
          <FacetFilter label={td("filters.assetClass")} options={classOptions} selected={query.assetClass} onToggle={(v) => onQueryChange(toggleFacet(query, "assetClass", v))} />
          <FacetFilter label={td("filters.contractor")} options={contractorOptions} selected={query.contractorId} onToggle={(v) => onQueryChange(toggleFacet(query, "contractorId", v))} />
          <FacetFilter label={td("filters.band")} options={bandOptions} selected={query.band} onToggle={(v) => onQueryChange(toggleFacet(query, "band", v))} />
        </div>
        <FilterBar filters={filterItems} onChange={(next) => onQueryChange(filterItemsToAgreementsQuery(next))} savedViews={[]} onSaveView={() => undefined} />
      </div>

      <Table<MaintenanceAgreementRow>
        tableId="s18b-agreements"
        columns={columns}
        rows={items}
        getRowId={(row) => row.id}
        captionKey="screens.s18plan.dashboard.caption"
        state={tableState}
        density="dense"
        onRowOpen={onOpen}
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s18plan.dashboard.empty", actionLabelKey: "buttons.open" }}
      />
    </>
  );
}
