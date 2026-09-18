import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * KpiTile — eCapital UI instructions §4.
 *
 * | Prop        | Type                    | Notes                                                        |
 * |-------------|-------------------------|---------------------------------------------------------------|
 * | label       | string                  | Eyebrow caption, e.g. «Εγκεκριμένος προϋπολογισμός».          |
 * | value       | string                  | Preformatted figure, e.g. `formatEUR(x)`. Ignored when loading/error. |
 * | comparator  | string?                 | Preformatted line beneath the figure, e.g. «62 % του έτους».  |
 * | trend       | "up" \| "down"?         | Optional trend arrow next to the comparator (SVG, never a glyph). |
 * | state       | "default" \| "loading" \| "error" | Defaults to "default".                              |
 * | onRetry     | () => void              | Shown as a text link in the error state when provided.        |
 *
 * States: default, loading (skeleton), error — per the brief's component spec.
 * "empty", "noPermission" and "offline" do not apply: a KpiTile never owns a
 * fetch of its own, it only renders a value its parent already resolved.
 */

export type KpiTileState = "default" | "loading" | "error";
export type KpiTileTrend = "up" | "down";

export interface KpiTileProps {
  label: string;
  value: string;
  comparator?: string;
  trend?: KpiTileTrend;
  state?: KpiTileState;
  onRetry?: () => void;
}

const TREND_ICON = { up: ArrowUp, down: ArrowDown } as const;

export function KpiTile({ label, value, comparator, trend, state = "default", onRetry }: KpiTileProps) {
  const t = useTranslations();
  const TrendIcon = trend ? TREND_ICON[trend] : undefined;

  return (
    <div className="bg-k-white rounded-k shadow-k p-s-6" data-state={state}>
      <p className="eyebrow text-k-text">{label}</p>

      {state === "loading" && (
        <div aria-busy="true" className="mt-s-3">
          <span className="sr-only">{t("common.loading")}</span>
          <div className="h-[32px] w-[60%] rounded-k bg-k-grey animate-pulse" />
          <div className="mt-s-2 h-[14px] w-[40%] rounded-k bg-k-grey animate-pulse" />
        </div>
      )}

      {state === "error" && (
        <div className="mt-s-3">
          <p className="text-fs-14 text-k-red">{t("components.kpiTile.error")}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-s-1 text-fs-14 text-k-blue underline underline-offset-2">
              {t("common.retry")}
            </button>
          )}
        </div>
      )}

      {state === "default" && (
        <>
          <p className="mt-s-1 text-fs-32 font-k-mono text-k-ink leading-[1.2]">{value}</p>
          {comparator && (
            // RULE (UI instructions §1): --k-text-muted is only used at 14px+ on white — the
            // comparator line qualifies (14px, on the tile's white background).
            <p className="mt-s-1 flex items-center gap-s-1 text-fs-14 text-k-text-muted">
              {TrendIcon && <TrendIcon aria-hidden="true" size={20} strokeWidth={1.5} />}
              <span>{comparator}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
