"use client";

// S23a «Αξιολόγηση αναδόχων» — R39 (CAPEX-01 §11, ADR-0032 §5)
//
/**
 * ContractorScorecardBody — the two kinds of contractor the organisation
 * has: the capital ones, one Table row each, and the maintenance ones, one
 * compact card per agreement with S22's figures for the same period.
 *
 * | Prop     | Type                        | Notes                 |
 * |----------|-----------------------------|-----------------------|
 * | report   | ContractorScorecardReport?  | Absent while loading. |
 * | state    | BodyState                   |                       |
 * | onExport | () => void                  |                       |
 *
 * S22's `Scorecard` is a whole screen (agreement picker, period, tables),
 * not a set of exported pieces, so the card here is a small summary of the
 * same contract `Scorecard` with S22's own labels.
 *
 * RULE (ADR-0032 §5): a rate the register cannot support is null and shows
 * «—»; nothing is invented. RULE (ADR-0031 §2): where catalogue penalty
 * rates are missing, the card says so next to the amount.
 */
import { useTranslations } from "next-intl";
import type { CapitalContractorRow, ContractorScorecardReport, Scorecard } from "@ecapital/shared";
import { Table, type TableColumn } from "@/components/table";
import { formatDecimal, formatEUR, formatInt } from "@/lib/format";
import { DASH, pctOrDash } from "../cells";
import { EMPTY, tableState, type BodyProps } from "./types";

const P = "screens.s23a.reports.CONTRACTOR_SCORECARD";

function MaintenanceCard({ sc }: { sc: Scorecard }) {
  const t = useTranslations();
  const ratio = (key: "response" | "restore" | "report" | "pm") => {
    const r = sc[key];
    return (
      <div key={key}>
        <dt className="text-fs-14 text-k-text">{t(`screens.s22.kpi.${key}`)}</dt>
        <dd className="num text-left text-fs-16 text-k-ink">
          {pctOrDash(r.pct)} <span className="text-fs-14 text-k-text">({t("screens.s22.kpi.ratio", { onTime: formatInt(r.onTime), due: formatInt(r.due) })})</span>
        </dd>
      </div>
    );
  };
  const downtime = sc.availability.criticalDowntimeHours + sc.availability.otherDowntimeHours;
  return (
    <article className="report-card rounded-k border border-k-grey bg-k-white p-s-4">
      <h3 className="text-fs-16 text-k-blue-deep">{t(`${P}.cardHeading`, { contractor: sc.contractorName, ref: sc.contractRef })}</h3>
      <dl className="mt-s-3 grid grid-cols-2 gap-s-3 tablet:grid-cols-3">
        {ratio("response")}
        {ratio("restore")}
        {ratio("report")}
        {ratio("pm")}
        <div>
          <dt className="text-fs-14 text-k-text">{t(`${P}.downtime`)}</dt>
          <dd className="num text-left text-fs-16 text-k-ink">{t("screens.s22.hours", { count: formatDecimal(downtime) })}</dd>
        </div>
        <div>
          <dt className="text-fs-14 text-k-text">{t(`${P}.penalties`)}</dt>
          <dd className="num text-left text-fs-16 text-k-ink">
            {formatEUR(sc.penalties.totalEur)}{" "}
            <span className="text-fs-14 text-k-text">
              {sc.penalties.ratesMissing ? t("screens.s22.kpi.ratesMissingShort") : t("screens.s22.kpi.ratesComplete")}
            </span>
          </dd>
        </div>
      </dl>
      {sc.penalties.ratesMissing && (
        <p role="note" className="mt-s-3 rounded-k bg-k-amber-bg p-s-2 text-fs-14 text-k-ink">
          {t(`${P}.ratesMissing`)}
        </p>
      )}
    </article>
  );
}

export function ContractorScorecardBody({ report, state, onExport, onRetry }: BodyProps<ContractorScorecardReport>) {
  const t = useTranslations();
  const capital = report?.capital ?? [];
  const maintenance = report?.maintenance ?? [];
  const nothing = state === "default" && capital.length === 0 && maintenance.length === 0;

  const pctCol = (id: string, key: string, get: (r: CapitalContractorRow) => number | null): TableColumn<CapitalContractorRow> => ({
    id,
    headerKey: `${P}.columns.${key}`,
    accessor: (r) => get(r) ?? -1,
    numeric: true,
    cell: (r) => pctOrDash(get(r)),
  });
  const columns: TableColumn<CapitalContractorRow>[] = [
    { id: "contractor", headerKey: `${P}.columns.contractor`, accessor: (r) => r.contractorName },
    { id: "contracts", headerKey: `${P}.columns.contracts`, accessor: (r) => r.contracts, numeric: true, cell: (r) => formatInt(r.contracts) },
    { id: "contractValue", headerKey: `${P}.columns.contractValue`, accessor: (r) => r.contractValue, numeric: true, cell: (r) => formatEUR(r.contractValue) },
    { id: "overdue", headerKey: `${P}.columns.overdue`, accessor: (r) => r.overdueContracts, numeric: true, cell: (r) => formatInt(r.overdueContracts) },
    pctCol("onTime", "onTime", (r) => r.onTimePct),
    pctCol("variationRate", "variationRate", (r) => r.variationRatePct),
    { id: "defects", headerKey: `${P}.columns.defects`, accessor: (r) => r.defects, numeric: true, cell: (r) => formatInt(r.defects) },
    { id: "openDefects", headerKey: `${P}.columns.openDefects`, accessor: (r) => r.openDefects, numeric: true, cell: (r) => formatInt(r.openDefects) },
    {
      id: "defectRate",
      headerKey: `${P}.columns.defectRate`,
      accessor: (r) => r.defectRate ?? -1,
      numeric: true,
      cell: (r) => (r.defectRate === null ? DASH : formatDecimal(r.defectRate)),
    },
    pctCol("rfiBreach", "rfiBreach", (r) => r.rfiBreachPct),
    pctCol("claimAccuracy", "claimAccuracy", (r) => r.claimAccuracyPct),
  ];

  if (nothing) {
    return (
      <div className="rounded-k border border-k-grey bg-k-white p-s-8 text-center">
        <p className="text-fs-16 text-k-ink">{t("screens.s23a.empty")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-s-6">
      <section className="flex flex-col gap-s-3">
        <h2 className="text-fs-20">{t(`${P}.capitalTitle`)}</h2>
        <Table<CapitalContractorRow>
          tableId="s23a-contractor-capital"
          columns={columns}
          rows={capital}
          getRowId={(r) => r.contractorId}
          captionKey={`${P}.capitalTitle`}
          state={tableState(state, capital.length)}
          density="comfortable"
          onExport={onExport}
          onRetry={onRetry}
          emptyState={EMPTY}
        />
      </section>
      {state !== "loading" && state !== "error" && (
        <section className="flex flex-col gap-s-3">
          <h2 className="text-fs-20">{t(`${P}.maintenanceTitle`)}</h2>
          {maintenance.length === 0 ? (
            <p className="text-fs-16 text-k-text">{t(`${P}.maintenanceEmpty`)}</p>
          ) : (
            <div className="grid grid-cols-1 gap-s-4 desktop:grid-cols-2 print:grid-cols-2">
              {maintenance.map((sc) => (
                <MaintenanceCard key={sc.maintenanceContractId} sc={sc} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
