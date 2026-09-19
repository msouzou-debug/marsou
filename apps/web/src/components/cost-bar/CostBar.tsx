/**
 * CostBar — the four-ledger cost bar (UI instructions §4, brief §7 glossary).
 *
 * One 24px horizontal bar showing the four ledgers of R13 against each other:
 * approved budget as the track, commitments and spend drawn inside it, and a
 * vertical --k-ink line at the approved budget. Pure CSS and one inline SVG
 * marker — no chart library, no canvas.
 *
 * Serves R13 (four-ledger cost model) and R03 (the same figures roll up to the
 * portfolio dashboard).
 *
 * | Prop        | Type              | Default     | Meaning |
 * |-------------|-------------------|-------------|---------|
 * | `approved`  | `number`          | —           | Εγκεκριμένος προϋπολογισμός, EUR. Sets the track and the marker line. |
 * | `committed` | `number \| null`  | —           | Δεσμεύσεις, EUR. `null` before the SAP import (M2, contract §`ProjectLedgers`). |
 * | `spent`     | `number \| null`  | —           | Δαπάνες, EUR. `null` before the SAP import. |
 * | `forecast`  | `number \| null`  | —           | Πρόβλεψη τελικού κόστους, EUR. Drawn as a hollow marker. `null` before the SAP import. |
 * | `state`     | `CostBarState`    | `"default"` | `default` \| `loading` \| `empty` \| `error` (UI §6). |
 * | `onRetry`   | `() => void`      | —           | Retry button in the `error` state; hidden without it. |
 * | `labels`    | `Partial<Record<"approved"\|"committed"\|"spent"\|"forecast", string>>` | — | Overrides the legend text for the given ledgers only — a caller such as S07, whose "approved"/"committed" mean «Αρχική αξία»/«Τρέχουσα αξία» rather than the glossary's own words, passes just those two and keeps the shared defaults for the rest. |
 *
 * RULE (S03): when `committed`, `spent` and `forecast` are all `null` — a
 * project with no SAP data yet — the bar draws only the approved track (no
 * commitment/spend segments, no overflow, no forecast marker, since there is
 * nothing to compare against the line) and a 14px line explains why, instead
 * of silently showing zeroes.
 *
 * No permission and offline are not implemented here: the bar holds no controls
 * and no writes, so offline shows the cached figures unchanged and access is
 * decided by the screen that renders it.
 */

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { formatEUR } from "@/lib/format";

export type CostBarState = "default" | "loading" | "empty" | "error";

export interface CostBarLabels {
  approved?: string;
  committed?: string;
  spent?: string;
  forecast?: string;
}

export interface CostBarProps {
  approved: number;
  committed: number | null;
  spent: number | null;
  forecast: number | null;
  state?: CostBarState;
  onRetry?: () => void;
  labels?: CostBarLabels;
}

// Bar geometry from UI instructions §4. Not part of the spacing scale, so it
// lives here as a named constant rather than as loose numbers in the markup.
const BAR_HEIGHT_PX = 24;
const APPROVED_LINE_WIDTH_PX = 2;
const APPROVED_LINE_OVERHANG_PX = 4;
const FORECAST_MARKER_PX = 12;

const COMMITTED_FILL = "color-mix(in srgb, var(--k-blue-deep) 30%, transparent)";
const SPENT_FILL = "var(--k-blue-deep)";
const APPROVED_FILL = "var(--k-grey)";
// RULE: the overflow must survive greyscale print, so it carries a diagonal
// hatch and a written amount as well as --k-red (UI instructions §4 and §7).
const OVERFLOW_FILL =
  "repeating-linear-gradient(45deg, var(--k-red) 0 4px, var(--k-red-bg) 4px 8px)";

function percent(value: number, domainMax: number): number {
  if (domainMax <= 0) return 0;
  return Math.max(0, Math.min(100, (value / domainMax) * 100));
}

export function CostBar({
  approved,
  committed,
  spent,
  forecast,
  state = "default",
  onRetry,
  labels,
}: CostBarProps) {
  const t = useTranslations("components.costBar");
  const tRoot = useTranslations();

  if (state === "loading") {
    return (
      <div aria-busy="true" aria-label={t("loading")}>
        <span
          aria-hidden="true"
          className="block w-full rounded-k-chip bg-k-grey"
          style={{ height: BAR_HEIGHT_PX }}
        />
        <ul className="mt-s-4 grid grid-cols-2 gap-s-3 tablet:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <li key={index}>
              <span aria-hidden="true" className="block h-s-3 w-full rounded-k-chip bg-k-grey" />
              <span aria-hidden="true" className="mt-s-2 block h-s-4 w-full rounded-k-chip bg-k-grey" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="rounded-k border border-k-grey p-s-6 text-center">
        <p className="text-fs-16 text-k-ink">{t("error")}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
          >
            {tRoot("common.retry")}
          </button>
        )}
      </div>
    );
  }

  // RULE (contract `ProjectLedgers`): a project with no SAP data yet reports
  // all three ledgers as `null`, never zero. Nothing to compare against the
  // approved track, so the bar draws the track alone and says why underneath.
  const pending = committed === null && spent === null && forecast === null;

  const domainMax = Math.max(approved, committed ?? 0, spent ?? 0, forecast ?? 0, 0);

  // Empty is "no budget yet": nothing has been approved and nothing booked.
  if (state === "empty" || domainMax <= 0) {
    return (
      <div className="rounded-k border border-k-grey p-s-6 text-center">
        <p className="text-fs-16 text-k-ink">{t("empty")}</p>
      </div>
    );
  }

  // RULE: if commitments or spend exceed the approved budget the bar runs past
  // the approved line and the part beyond it is drawn in --k-red, with the
  // overflow amount written to the right of the bar (UI instructions §4).
  const overrunTo = Math.max(committed ?? 0, spent ?? 0);
  const overflow = Math.max(0, overrunTo - approved);
  const hasOverflow = overflow > 0;

  const approvedPct = percent(approved, domainMax);
  const eurOrDash = (value: number | null) => (value === null ? tRoot("common.notAvailable") : formatEUR(value));
  const summary = t("summary", {
    approved: formatEUR(approved),
    committed: eurOrDash(committed),
    spent: eurOrDash(spent),
    forecast: eurOrDash(forecast),
  });

  const legend: Array<{ key: string; label: string; value: number | null; swatch: CSSProperties }> = [
    {
      key: "approved",
      label: labels?.approved ?? t("approved"),
      value: approved,
      swatch: { background: APPROVED_FILL, border: "1px solid var(--k-text-muted)" },
    },
    { key: "committed", label: labels?.committed ?? t("committed"), value: committed, swatch: { background: COMMITTED_FILL } },
    { key: "spent", label: labels?.spent ?? t("spent"), value: spent, swatch: { background: SPENT_FILL } },
    {
      key: "forecast",
      label: labels?.forecast ?? t("forecast"),
      value: forecast,
      swatch: { border: "2px solid var(--k-ink)", borderRadius: "50%" },
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-s-4">
        <div
          role="img"
          aria-label={summary}
          className="relative flex-1"
          style={{ height: BAR_HEIGHT_PX, printColorAdjust: "exact" }}
        >
          {/* Approved budget: outline track with a --k-grey fill. */}
          <span
            className="absolute inset-y-0 left-0 rounded-k-chip border border-k-text-muted"
            style={{ width: `${approvedPct}%`, background: APPROVED_FILL }}
          />
          {/* Overflow beyond the approved line. */}
          {hasOverflow && (
            <span
              data-testid="cost-bar-overflow"
              className="absolute inset-y-0 border border-k-red"
              style={{
                left: `${approvedPct}%`,
                width: `${percent(overrunTo, domainMax) - approvedPct}%`,
                background: OVERFLOW_FILL,
              }}
            />
          )}
          {/* Commitments, then spend, drawn inside the approved track. Skipped
              entirely while pending: there is nothing booked to draw yet, and
              a zero-width segment would read as "zero spend" rather than
              "unknown" (contract `ProjectLedgers`: null, never zero). */}
          {!pending && (
            <>
              <span
                className="absolute inset-y-0 left-0 rounded-k-chip"
                style={{
                  width: `${percent(Math.min(committed ?? 0, approved), domainMax)}%`,
                  background: COMMITTED_FILL,
                }}
              />
              <span
                className="absolute inset-y-0 left-0 rounded-k-chip"
                style={{
                  width: `${percent(Math.min(spent ?? 0, approved), domainMax)}%`,
                  background: SPENT_FILL,
                }}
              />
            </>
          )}
          {/* The approved budget line. */}
          <span
            title={t("approvedLine")}
            className="absolute"
            style={{
              left: `calc(${approvedPct}% - ${APPROVED_LINE_WIDTH_PX / 2}px)`,
              top: -APPROVED_LINE_OVERHANG_PX,
              bottom: -APPROVED_LINE_OVERHANG_PX,
              width: APPROVED_LINE_WIDTH_PX,
              background: "var(--k-ink)",
            }}
          />
          {/* Forecast: hollow marker on the same axis. Skipped while pending —
              there is no forecast yet either. */}
          {forecast !== null && (
            <svg
              aria-hidden="true"
              width={FORECAST_MARKER_PX}
              height={FORECAST_MARKER_PX}
              viewBox="0 0 12 12"
              className="absolute"
              style={{
                left: `calc(${percent(forecast, domainMax)}% - ${FORECAST_MARKER_PX / 2}px)`,
                top: `calc(50% - ${FORECAST_MARKER_PX / 2}px)`,
              }}
            >
              <circle cx="6" cy="6" r="5" fill="var(--k-white)" stroke="var(--k-ink)" strokeWidth="2" />
            </svg>
          )}
        </div>

        {hasOverflow && (
          <p className="whitespace-nowrap text-fs-14 text-k-red">
            {t("overflow")}{" "}
            <span className="font-k-mono tabular-nums">{formatEUR(overflow)}</span>
          </p>
        )}
      </div>

      {/* RULE (S03): while committed/spent/forecast are all null, a 14px line
          explains why the bar shows only the approved track — never a blank
          space the reader has to guess about. */}
      {pending && <p className="mt-s-2 text-fs-14 text-k-text">{t("pendingSap")}</p>}

      <ul className="mt-s-4 grid grid-cols-2 gap-s-3 tablet:grid-cols-4">
        {legend.map((item) => (
          <li key={item.key} className="flex items-start gap-s-2">
            <span
              aria-hidden="true"
              className="mt-s-1 inline-block h-s-3 w-s-3 shrink-0 rounded-k-chip"
              style={item.swatch}
            />
            <span>
              <span className="block text-fs-14 text-k-text">{item.label}</span>
              <span className="block font-k-mono text-fs-14 tabular-nums text-k-ink">
                {eurOrDash(item.value)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
