"use client";

// S04 — R17
//
/**
 * CashflowChart — the small inline-SVG line chart under S04's cash-flow
 * table (build brief §5 S10... actually S04, "a small SVG line (plan
 * --k-grey, actual --k-blue-deep, no pie charts)"). Cumulative planned vs.
 * cumulative actual spend across the selected months — a running total is
 * what a "are we ahead or behind the plan" question actually needs, not the
 * monthly figure alone.
 *
 * | Prop  | Type            | Notes                                                              |
 * |-------|-----------------|----------------------------------------------------------------------|
 * | rows  | CashflowRow[]   | In period order. A `null` cumulative value breaks the line rather than drawing a false zero. |
 * | state | CashflowChartState | `default` \| `loading` \| `empty` \| `error` (UI §6).              |
 *
 * Pure SVG, no chart library, no canvas — same restraint `CostBar` documents.
 */
import { useTranslations } from "next-intl";
import type { CashflowRow } from "@ecapital/shared";
import { formatEUR } from "@/lib/format";

export type CashflowChartState = "default" | "loading" | "empty" | "error";

export interface CashflowChartProps {
  rows: CashflowRow[];
  state?: CashflowChartState;
}

const WIDTH = 560;
const HEIGHT = 140;
const PAD = 24;

function buildPoints(values: Array<number | null>, max: number): Array<{ x: number; y: number } | null> {
  const innerWidth = WIDTH - PAD * 2;
  const innerHeight = HEIGHT - PAD * 2;
  const step = values.length > 1 ? innerWidth / (values.length - 1) : 0;
  return values.map((value, index) => {
    if (value === null || max <= 0) return null;
    const x = PAD + step * index;
    const y = PAD + innerHeight - (value / max) * innerHeight;
    return { x, y };
  });
}

/** Splits a points array into runs, so a null (missing month) breaks the line rather than being skipped over. */
function toPolylines(points: Array<{ x: number; y: number } | null>): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  for (const point of points) {
    if (point) current.push(`${point.x},${point.y}`);
    else if (current.length) {
      lines.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) lines.push(current.join(" "));
  return lines;
}

export function CashflowChart({ rows, state = "default" }: CashflowChartProps) {
  const t = useTranslations("components.cashflow-chart");

  if (state === "loading") {
    return <span aria-hidden="true" className="block h-[140px] w-full rounded-k bg-k-grey" aria-busy="true" />;
  }
  if (state === "error") {
    return <p className="text-fs-14 text-k-text">{t("error")}</p>;
  }
  if (state === "empty" || rows.length === 0) {
    return <p className="text-fs-14 text-k-text">{t("empty")}</p>;
  }

  const planned = rows.map((r) => r.cumulativePlanned);
  const actual = rows.map((r) => r.cumulativeActual);
  const max = Math.max(0, ...[...planned, ...actual].filter((v): v is number => v !== null));

  const plannedLines = toPolylines(buildPoints(planned, max));
  const actualLines = toPolylines(buildPoints(actual, max));

  const summary = t("summary", {
    from: rows[0]?.period ?? "",
    to: rows[rows.length - 1]?.period ?? "",
  });

  return (
    <div>
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        preserveAspectRatio="none"
      >
        <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} stroke="var(--k-grey)" strokeWidth={1} />
        {plannedLines.map((points, i) => (
          <polyline key={`plan-${i}`} points={points} fill="none" stroke="var(--k-grey)" strokeWidth={2} />
        ))}
        {actualLines.map((points, i) => (
          <polyline key={`actual-${i}`} points={points} fill="none" stroke="var(--k-blue-deep)" strokeWidth={2} />
        ))}
      </svg>
      <ul className="mt-s-2 flex gap-s-4 text-fs-12 text-k-text">
        <li className="flex items-center gap-s-1">
          <span aria-hidden="true" className="inline-block h-0.5 w-s-4" style={{ background: "var(--k-grey)" }} />
          {t("planned")}
        </li>
        <li className="flex items-center gap-s-1">
          <span aria-hidden="true" className="inline-block h-0.5 w-s-4" style={{ background: "var(--k-blue-deep)" }} />
          {t("actual")}
        </li>
        {max > 0 && <li className="num ml-auto">{formatEUR(max)}</li>}
      </ul>
    </div>
  );
}
