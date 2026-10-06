"use client";

// S22 «Αξιολόγηση αναδόχων» — R37 (ADR-0031 §9)
//
/**
 * Scorecard — the pure S22 body: pick the agreement and the period
 * (current or previous quarter, or any dates), then the KpiTiles, the
 * by-band Table and the counts. A Table, no gauges (UI instructions §5).
 *
 * | Prop        | Type                     | Notes                                                       |
 * |-------------|--------------------------|-------------------------------------------------------------|
 * | agreements  | MaintenanceContract[]    | The select.                                                 |
 * | agreementId | string                   | "" until one is picked.                                     |
 * | period      | Period                   | `to` exclusive, like the API's.                             |
 * | today       | string                   | `YYYY-MM-DD`, Nicosia — for the quarter presets.            |
 * | scorecard   | Scorecard?               |                                                             |
 * | state       | ScorecardState           | `idle` = nothing picked yet.                                |
 * | onExport    | () => void               | GET /maintenance/scorecard.xlsx with the same query.        |
 *
 * RULE (ADR-0031 §2, contract `Scorecard.penalties.ratesMissing`): where a
 * catalogue rate is null the line is counted and its amount left out; the
 * penalties tile then says «ρήτρες ελλιπείς» and a sentence under the tiles
 * says why, so nobody withholds a figure that is short.
 * RULE: a ratio with nothing due is «—», never «0 %» or «100 %».
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MaintenanceContract, Scorecard as ScorecardType } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { KpiTile } from "@/components/kpi-tile";
import { Table, type TableColumn, type TableState } from "@/components/table";
import { formatDate, formatEUR, formatInt, formatPct } from "@/lib/format";
import { BandChip } from "@/screens/s18-work-orders/BandChip";
import { quarter, shiftDay, type Period } from "./period";

export type ScorecardState = "idle" | "default" | "loading" | "error" | "noPermission" | "offline";

export interface ScorecardProps {
  agreements: MaintenanceContract[];
  agreementsLoading?: boolean;
  agreementId: string;
  onAgreement: (id: string) => void;
  period: Period;
  onPeriod: (next: Period) => void;
  today: string;
  scorecard?: ScorecardType;
  state: ScorecardState;
  onRetry?: () => void;
  onExport: () => void;
  noPermission: ReactNode;
}

type BandRow = ScorecardType["byBand"][number];

const pctOrDash = (pct: number | null) => (pct === null ? "—" : formatPct(pct));
const inputClass = "min-h-[44px] rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink";

export function Scorecard(props: ScorecardProps) {
  const { agreements, agreementsLoading, agreementId, onAgreement, period, onPeriod, today, scorecard, state, onRetry, onExport, noPermission } = props;
  const t = useTranslations();
  const hours = (h: number) => t("screens.s22.hours", { count: formatInt(h) });

  if (state === "noPermission") return <>{noPermission}</>;

  const current = quarter(today, 0);
  const previous = quarter(today, -1);
  const preset = period.from === current.from && period.to === current.to ? "current" : period.from === previous.from && period.to === previous.to ? "previous" : "custom";
  const agreement = agreements.find((a) => a.id === agreementId);

  const columns: TableColumn<BandRow>[] = [
    { id: "band", headerKey: "screens.s18.columns.band", accessor: (row) => ["CRITICAL", "P1", "P2"].indexOf(row.band), cell: (row) => <BandChip band={row.band} /> },
    { id: "corrective", headerKey: "screens.s22.byBand.corrective", accessor: (row) => row.corrective, numeric: true, cell: (row) => formatInt(row.corrective) },
    { id: "response", headerKey: "screens.s22.byBand.response", accessor: (row) => row.responseOnTimePct ?? -1, numeric: true, cell: (row) => pctOrDash(row.responseOnTimePct) },
    { id: "restore", headerKey: "screens.s22.byBand.restore", accessor: (row) => row.restoreOnTimePct ?? -1, numeric: true, cell: (row) => pctOrDash(row.restoreOnTimePct) },
    { id: "downtime", headerKey: "screens.s22.byBand.downtime", accessor: (row) => row.downtimeHours, numeric: true, cell: (row) => hours(row.downtimeHours) },
  ];

  const sc = scorecard;
  const tileState = state === "loading" ? "loading" : state === "error" ? "error" : "default";
  const showFigures = state === "default" || state === "offline" || state === "loading" || state === "error";
  const ratio = (r: { due: number; onTime: number; pct: number | null } | undefined) => ({
    value: r ? pctOrDash(r.pct) : "",
    comparator: r ? t("screens.s22.kpi.ratio", { onTime: formatInt(r.onTime), due: formatInt(r.due) }) : undefined,
  });

  const tableState: TableState = state === "default" ? (sc && sc.byBand.length > 0 ? "default" : "empty") : state === "idle" ? "empty" : state;

  return (
    <>
      <PageTitle
        eyebrow={
          <Link href="/maintenance" className="hover:underline">
            {t("nav.maintenance")}
          </Link>
        }
        title={t("screens.s22.title")}
      />
      <p className="mb-s-5 max-w-[720px] text-fs-16 text-k-text">{t("screens.s22.intro")}</p>

      <div className="mb-s-6 flex flex-wrap items-end gap-s-4">
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
          {t("screens.s22.agreement")}
          <select value={agreementId} onChange={(e) => onAgreement(e.target.value)} className={inputClass} disabled={agreementsLoading}>
            <option value="">{t("screens.s22.pickAgreement")}</option>
            {agreements.map((a) => (
              <option key={a.id} value={a.id}>
                {a.contractorName} · {a.ref}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-wrap items-end gap-s-2">
          <legend className="mb-s-1 text-fs-14 text-k-text">{t("screens.s22.period")}</legend>
          {(
            [
              ["current", current],
              ["previous", previous],
            ] as const
          ).map(([key, p]) => (
            <button
              key={key}
              type="button"
              aria-pressed={preset === key}
              onClick={() => onPeriod(p)}
              className={`min-h-[44px] rounded-k-chip border px-s-3 text-fs-14 ${preset === key ? "border-k-blue-deep bg-k-blue-bg text-k-ink" : "border-k-grey bg-k-white text-k-text"}`}
            >
              {t(`screens.s22.presets.${key}`)}
            </button>
          ))}
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t("screens.s22.from")}
            <input type="date" value={period.from} onChange={(e) => e.target.value && onPeriod({ ...period, from: e.target.value })} className={`num ${inputClass}`} />
          </label>
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t("screens.s22.to")}
            <input
              type="date"
              value={shiftDay(period.to, -1)}
              onChange={(e) => e.target.value && onPeriod({ ...period, to: shiftDay(e.target.value, 1) })}
              className={`num ${inputClass}`}
            />
          </label>
        </fieldset>
      </div>

      {state === "idle" ? (
        <p className="text-fs-16 text-k-text">{agreements.length === 0 && !agreementsLoading ? t("screens.s22.noAgreements") : t("screens.s22.pickFirst")}</p>
      ) : (
        <>
          {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}
          {sc && (
            <p className="mb-s-4 text-fs-16 text-k-ink">
              {t("screens.s22.heading", { contractor: sc.contractorName, ref: sc.contractRef, from: formatDate(sc.from), to: formatDate(shiftDay(sc.to.slice(0, 10), -1)) })}
            </p>
          )}

          {showFigures && (
            <div className="mb-s-4 grid grid-cols-2 gap-s-4 tablet:grid-cols-3 desktop:grid-cols-6">
              <KpiTile label={t("screens.s22.kpi.response")} {...ratio(sc?.response)} state={tileState} onRetry={onRetry} />
              <KpiTile label={t("screens.s22.kpi.restore")} {...ratio(sc?.restore)} state={tileState} onRetry={onRetry} />
              <KpiTile label={t("screens.s22.kpi.report")} {...ratio(sc?.report)} state={tileState} onRetry={onRetry} />
              <KpiTile label={t("screens.s22.kpi.pm")} {...ratio(sc?.pm)} state={tileState} onRetry={onRetry} />
              <KpiTile
                label={t("screens.s22.kpi.downtime")}
                value={sc ? hours(sc.availability.criticalDowntimeHours + sc.availability.otherDowntimeHours) : ""}
                comparator={
                  sc
                    ? t("screens.s22.kpi.downtimeSplit", {
                        critical: formatInt(sc.availability.criticalDowntimeHours),
                        other: formatInt(sc.availability.otherDowntimeHours),
                        allowance: formatInt(sc.availability.allowanceHours),
                      })
                    : undefined
                }
                state={tileState}
                onRetry={onRetry}
              />
              <KpiTile
                label={t("screens.s22.kpi.penalties")}
                value={sc ? formatEUR(sc.penalties.totalEur) : ""}
                comparator={sc ? (sc.penalties.ratesMissing ? t("screens.s22.kpi.ratesMissingShort") : t("screens.s22.kpi.ratesComplete")) : undefined}
                state={tileState}
                onRetry={onRetry}
              />
            </div>
          )}

          {sc?.penalties.ratesMissing && (
            <p role="note" className="mb-s-4 rounded-k bg-k-amber-bg p-s-3 text-fs-16 text-k-ink">
              {t("screens.s22.ratesMissing")}
            </p>
          )}

          {sc && (
            <div className="mb-s-6 grid grid-cols-1 gap-s-5 desktop:grid-cols-2">
              <section className="rounded-k border border-k-grey bg-k-white p-s-4">
                <h2 className="text-fs-20 text-k-blue-deep">{t("screens.s22.penaltiesTitle")}</h2>
                <dl className="mt-s-3 grid grid-cols-2 gap-s-3">
                  {(
                    [
                      ["pm", sc.penalties.pmEur],
                      ["response", sc.penalties.responseEur],
                      ["restore", sc.penalties.restoreEur],
                      ["availability", sc.penalties.availabilityEur],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-fs-12 text-k-text">{t(`screens.s22.penalties.${key}`)}</dt>
                      <dd className="num text-left text-fs-16 text-k-ink">{formatEUR(value)}</dd>
                    </div>
                  ))}
                  <div className="col-span-2">
                    <dt className="text-fs-12 text-k-text">{t("screens.s22.capUsed")}</dt>
                    <dd className={sc.penalties.capUsedPct === null ? "text-left text-fs-14 text-k-text" : "num text-left text-fs-16 text-k-ink"}>
                      {sc.penalties.capUsedPct === null
                        ? t("screens.s22.capNoValue")
                        : t("screens.s22.capOf", { used: formatPct(sc.penalties.capUsedPct), cap: agreement ? formatPct(agreement.penaltyCapPct, 0) : "—" })}
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="rounded-k border border-k-grey bg-k-white p-s-4">
                <h2 className="text-fs-20 text-k-blue-deep">{t("screens.s22.countsTitle")}</h2>
                <dl className="mt-s-3 grid grid-cols-2 gap-s-3 tablet:grid-cols-3">
                  {(
                    [
                      ["total", sc.workOrders.total],
                      ["corrective", sc.workOrders.corrective],
                      ["pm", sc.workOrders.pm],
                      ["statutory", sc.workOrders.statutory],
                      ["open", sc.workOrders.open],
                      ["repeatFailures", sc.repeatFailures],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-fs-12 text-k-text">{t(`screens.s22.counts.${key}`)}</dt>
                      <dd className="num text-left text-fs-20 text-k-ink">{formatInt(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          )}

          <Table<BandRow>
            tableId="s22-by-band"
            columns={columns}
            rows={sc?.byBand ?? []}
            getRowId={(row) => row.band}
            captionKey="screens.s22.byBand.title"
            state={tableState}
            density="comfortable"
            onExport={onExport}
            onRetry={onRetry}
            emptyState={{ messageKey: "screens.s22.byBand.empty", actionLabelKey: "buttons.exportExcel" }}
          />
        </>
      )}
    </>
  );
}
