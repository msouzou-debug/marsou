"use client";

/**
 * ForecastChart — the S17c replacement-forecast bar chart: estimated
 * replacement cost per year (M4 build brief item 6, "a simple bar chart
 * (SVG, brand blue, no pie chart)"). Pure inline SVG, no chart library, no
 * canvas — the same restraint `CostBar`/`CashflowChart` document.
 *
 * | Prop  | Type                 | Notes                                                    |
 * |-------|----------------------|---------------------------------------------------------------|
 * | rows  | ForecastChartRow[]   | One bar per year, in year order.                                |
 * | state | ForecastChartState   | `default` \| `loading` \| `empty` \| `error` (UI §6).           |
 *
 * RULE (UI instructions §0.5 / CONVENTIONS.md): a bar chart, never a pie —
 * money over a year range is a sequence, not a share of a whole.
 */
import { useTranslations } from "next-intl";
import { formatEUR } from "@/lib/format";

export interface ForecastChartRow {
  year: number;
  value: number;
}

export type ForecastChartState = "default" | "loading" | "empty" | "error";

export interface ForecastChartProps {
  rows: ForecastChartRow[];
  state?: ForecastChartState;
}

const HEIGHT = 160;
const BAR_GAP = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 24;
const BAR_WIDTH = 40;

export function ForecastChart({ rows, state = "default" }: ForecastChartProps) {
  const t = useTranslations("components.forecast-chart");

  if (state === "loading") {
    return <span aria-hidden="true" aria-busy="true" className="block h-[160px] w-full rounded-k bg-k-grey" />;
  }
  if (state === "error") {
    return <p className="text-fs-14 text-k-text">{t("error")}</p>;
  }
  if (state === "empty" || rows.length === 0) {
    return <p className="text-fs-14 text-k-text">{t("empty")}</p>;
  }

  const max = Math.max(0, ...rows.map((r) => r.value));
  const width = rows.length * (BAR_WIDTH + BAR_GAP) + BAR_GAP;
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const summary = t("summary", {
    years: rows.map((r) => `${r.year}: ${formatEUR(r.value)}`).join(", "),
  });

  return (
    <div>
      <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${HEIGHT}`} width="100%" height={HEIGHT} preserveAspectRatio="xMinYMid meet">
        <line x1={0} y1={HEIGHT - PAD_BOTTOM} x2={width} y2={HEIGHT - PAD_BOTTOM} stroke="var(--k-grey)" strokeWidth={1} />
        {rows.map((row, index) => {
          const barHeight = max > 0 ? (row.value / max) * innerHeight : 0;
          const x = BAR_GAP + index * (BAR_WIDTH + BAR_GAP);
          const y = HEIGHT - PAD_BOTTOM - barHeight;
          return (
            <g key={row.year}>
              <rect x={x} y={y} width={BAR_WIDTH} height={barHeight} fill="var(--k-blue-deep)" />
              <text x={x + BAR_WIDTH / 2} y={HEIGHT - PAD_BOTTOM + 16} textAnchor="middle" className="font-k-mono" fontSize={12} fill="var(--k-text)">
                {row.year}
              </text>
            </g>
          );
        })}
      </svg>
      {max > 0 && <p className="num mt-s-1 text-fs-12 text-k-text">{t("maxLabel", { value: formatEUR(max) })}</p>}
    </div>
  );
}
