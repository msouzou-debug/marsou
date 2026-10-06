// S23a — R39
//
// The small cells the seven report bodies share: «—» for a figure the
// system has no source for, a signed and coloured slippage, a coloured
// percentage chip. Presentational only.
import type { ReactNode } from "react";
import { formatEUR, formatPct } from "@/lib/format";

export const DASH = "—";

/** RULE (contract, ADR-0032 §5): null is «—», never 0 — the export leaves the cell blank the same way. */
export function eurOrDash(value: number | null): string {
  return value === null ? DASH : formatEUR(value);
}

export function pctOrDash(value: number | null): string {
  return value === null ? DASH : formatPct(value);
}

/**
 * Slippage = forecast − approved. RULE (contract `CapitalProgrammeRow.slippage`):
 * positive is over budget. Over is red with a «+»; under sits on a green tint
 * with the minus formatEUR already gives it (green text fails contrast, UI
 * instructions §7); zero and null are plain.
 */
export function Slippage({ value }: { value: number | null }) {
  if (value === null) return <>{DASH}</>;
  if (value > 0) return <span className="text-k-red">+{formatEUR(value)}</span>;
  if (value < 0) return <span className="rounded-k-chip bg-k-green-bg px-s-1 text-k-ink">{formatEUR(value)}</span>;
  return <>{formatEUR(0)}</>;
}

/** Sum of the figures that have a source; «—» (null) when none has. The Excel's SUM over blanks does the same. */
export function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/** Two figures stacked in one cell: the main one, and a smaller line under it. */
export function Stacked({ top, bottom }: { top: ReactNode; bottom?: ReactNode }) {
  return (
    <span className="block">
      <span className="block">{top}</span>
      {bottom !== undefined && bottom !== null && <span className="block text-fs-12 text-k-text">{bottom}</span>}
    </span>
  );
}
