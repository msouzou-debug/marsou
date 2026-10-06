"use client";

// S21 — R35 (ADR-0031 §7)
//
/**
 * BacklogSummary — the unfunded/funded totals by unit and risk band, the
 * input to next year's capital programme. One row per unit, four band
 * columns in the defect's NHS ERIC order, each cell the count, the
 * estimate and its funded/unfunded split, and a total column.
 *
 * | Prop  | Type                  | Notes                                            |
 * |-------|-----------------------|--------------------------------------------------|
 * | rows  | BacklogSummaryRow[]   | One per unit × band, OPEN and FUNDED items only. |
 * | state | "default"\|"loading"\|"error"\|"empty" |                                 |
 *
 * RULE (UI instructions §4 RagChip): the band headers are tinted like a
 * RagChip — and always carry the band's name, so the colour is never the
 * only signal.
 */
import { useTranslations } from "next-intl";
import type { BacklogSummaryRow, RiskBand } from "@ecapital/shared";
import { formatEUR, formatInt } from "@/lib/format";

export const RISK_BANDS: RiskBand[] = ["HIGH", "SIGNIFICANT", "MODERATE", "LOW"];

export const BAND_TINT: Record<RiskBand, string> = {
  HIGH: "bg-k-red-bg",
  SIGNIFICANT: "bg-k-amber-bg",
  MODERATE: "bg-k-blue-bg",
  LOW: "bg-k-green-bg",
};

export function RiskBandChip({ band }: { band: RiskBand }) {
  const t = useTranslations("riskBands");
  return <span className={`inline-flex items-center whitespace-nowrap rounded-k-chip px-s-2 py-s-1 text-fs-14 text-k-ink ${BAND_TINT[band]}`}>{t(band)}</span>;
}

interface Cell {
  count: number;
  cost: number;
  funded: number;
  unfunded: number;
}

const ZERO: Cell = { count: 0, cost: 0, funded: 0, unfunded: 0 };

function add(a: Cell, r: BacklogSummaryRow): Cell {
  return { count: a.count + r.count, cost: a.cost + r.costEstimate, funded: a.funded + r.fundedCost, unfunded: a.unfunded + r.unfundedCost };
}

function CellView({ c }: { c: Cell }) {
  const t = useTranslations("screens.s21.summary");
  if (c.count === 0) return <span className="text-k-text">—</span>;
  return (
    <span className="block">
      <span className="block text-fs-14 text-k-ink">
        {t("items", { count: c.count })} · {formatEUR(c.cost)}
      </span>
      <span className="block text-fs-12 text-k-text">{t("split", { funded: formatEUR(c.funded), unfunded: formatEUR(c.unfunded) })}</span>
    </span>
  );
}

export function BacklogSummary({ rows, state }: { rows: BacklogSummaryRow[]; state: "default" | "loading" | "error" | "empty" }) {
  const t = useTranslations();

  if (state === "loading") return <div aria-busy="true" className="h-s-12 animate-pulse rounded-k bg-k-grey" />;
  if (state === "error") return <p className="text-fs-14 text-k-red">{t("states.error.loadFailed")}</p>;
  if (state === "empty" || rows.length === 0) return <p className="text-fs-16 text-k-text">{t("screens.s21.summary.empty")}</p>;

  const units = new Map<string, { name: string; cells: Record<RiskBand, Cell> }>();
  for (const r of rows) {
    const u = units.get(r.orgUnitId) ?? { name: r.unitName, cells: { HIGH: ZERO, SIGNIFICANT: ZERO, MODERATE: ZERO, LOW: ZERO } };
    u.cells[r.riskBand] = add(u.cells[r.riskBand], r);
    units.set(r.orgUnitId, u);
  }
  const totals: Record<RiskBand, Cell> = { HIGH: ZERO, SIGNIFICANT: ZERO, MODERATE: ZERO, LOW: ZERO };
  for (const r of rows) totals[r.riskBand] = add(totals[r.riskBand], r);
  const sum = (cells: Record<RiskBand, Cell>): Cell =>
    RISK_BANDS.reduce((acc, b) => ({ count: acc.count + cells[b].count, cost: acc.cost + cells[b].cost, funded: acc.funded + cells[b].funded, unfunded: acc.unfunded + cells[b].unfunded }), ZERO);

  const th = "border-b border-k-grey px-s-3 py-s-2 text-left text-fs-14 font-bold text-k-blue-deep";
  const td = "border-b border-k-grey px-s-3 py-s-2 align-top";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse">
        <caption className="sr-only">{t("screens.s21.summary.title")}</caption>
        <thead>
          <tr>
            <th scope="col" className={th}>
              {t("common.unit")}
            </th>
            {RISK_BANDS.map((b) => (
              <th key={b} scope="col" className={th}>
                <RiskBandChip band={b} />
              </th>
            ))}
            <th scope="col" className={th}>
              {t("screens.s21.summary.total")}
            </th>
          </tr>
        </thead>
        <tbody>
          {[...units.entries()].map(([id, u]) => (
            <tr key={id}>
              <th scope="row" className={`${td} text-left text-fs-14 font-normal text-k-ink`}>
                {u.name}
              </th>
              {RISK_BANDS.map((b) => (
                <td key={b} className={td}>
                  <CellView c={u.cells[b]} />
                </td>
              ))}
              <td className={td}>
                <CellView c={sum(u.cells)} />
              </td>
            </tr>
          ))}
        </tbody>
        {units.size > 1 && (
          <tfoot>
            <tr className="font-bold">
              <th scope="row" className={`${td} text-left text-fs-14 text-k-ink`}>
                {t("screens.s21.summary.total")}
              </th>
              {RISK_BANDS.map((b) => (
                <td key={b} className={td}>
                  <CellView c={totals[b]} />
                </td>
              ))}
              <td className={td}>
                <CellView c={sum(totals)} />
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s21.summary.note", { amount: formatEUR(sum(totals).unfunded), count: formatInt(sum(totals).count) })}</p>
    </div>
  );
}
