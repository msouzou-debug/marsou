// S01 — R03

/**
 * Sparkline — S01's «Πορεία» column (UI instructions §5).
 *
 * A 96×24 inline SVG comparing a unit's cumulative spend against its
 * cumulative plan across the twelve months of the year. No chart library:
 * two polylines, drawn to the same vertical scale so the gap between them
 * reads at a glance.
 *
 * | Prop      | Type       | Notes                                             |
 * |-----------|------------|-----------------------------------------------------|
 * | plan      | number[]   | 12 cumulative monthly points, `--k-grey` line.      |
 * | spend     | number[]   | 12 cumulative monthly points, `--k-blue-deep` line. |
 * | ariaLabel | string     | Describes spend vs plan in words (already resolved). |
 *
 * State: default only — this draws a value its parent already resolved, the
 * same reasoning RagChip documents for itself.
 */

const WIDTH = 96;
const HEIGHT = 24;
const PAD_X = 1;
const PAD_Y = 2;

function toPoints(values: number[], max: number): string {
  if (values.length < 2) return "";
  const stepX = (WIDTH - PAD_X * 2) / (values.length - 1);
  return values
    .map((value, index) => {
      const x = PAD_X + index * stepX;
      const y = max > 0 ? HEIGHT - PAD_Y - (value / max) * (HEIGHT - PAD_Y * 2) : HEIGHT - PAD_Y;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export interface SparklineProps {
  plan: number[];
  spend: number[];
  ariaLabel: string;
}

export function Sparkline({ plan, spend, ariaLabel }: SparklineProps) {
  // Both lines share one vertical scale so "spend is above/below plan" reads
  // as a direct visual comparison, not two independently-scaled charts.
  const max = Math.max(1, ...plan, ...spend);
  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={ariaLabel}
      className="shrink-0"
    >
      <polyline points={toPoints(plan, max)} fill="none" stroke="var(--k-grey)" strokeWidth={2} />
      <polyline points={toPoints(spend, max)} fill="none" stroke="var(--k-blue-deep)" strokeWidth={2} />
    </svg>
  );
}
