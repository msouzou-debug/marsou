"use client";

// S06 — R07
//
/**
 * RiskMatrix — the 5×5 likelihood × impact grid (build brief): cells tinted
 * by score band, the count in each cell, both axes labelled in words.
 *
 * | Prop  | Type   | Notes                                       |
 * |-------|--------|-------------------------------------------------|
 * | risks | Risk[] | The project's full risk list (every status).      |
 *
 * State: default only — this reflects data its parent already has; there is
 * nothing here to load, be empty over (a zero count is just an empty cell,
 * not the component's own empty state) or lack permission for.
 */
import { useTranslations } from "next-intl";
import type { Risk } from "@ecapital/shared";
import { countAt, scoreBand, type ScoreBand } from "./risk-matrix";

export interface RiskMatrixProps {
  risks: Risk[];
}

const LEVELS = [1, 2, 3, 4, 5];
// High likelihood at the top, the usual risk-matrix reading direction.
const LIKELIHOOD_ROWS = [...LEVELS].reverse();

const BAND_BG: Record<ScoreBand, string> = { LOW: "bg-k-green-bg", MEDIUM: "bg-k-amber-bg", HIGH: "bg-k-red-bg" };
const BAND_KEY: Record<ScoreBand, string> = { LOW: "bandLow", MEDIUM: "bandMedium", HIGH: "bandHigh" };

export function RiskMatrix({ risks }: RiskMatrixProps) {
  const t = useTranslations("screens.s06.matrix");

  return (
    <div className="rounded-k border border-k-grey bg-k-white p-s-4">
      <h3 className="text-fs-16 font-bold text-k-blue-deep">{t("title")}</h3>
      <div className="mt-s-3 flex items-stretch gap-s-2">
        {/* RULE (UI instructions §4/§7): the axes are named in visible text,
            not left to position alone — `--k-text` at 12px fails contrast
            below 14px, so this is 14px even set sideways. */}
        <div className="flex items-center justify-center">
          <span className="whitespace-nowrap text-fs-14 text-k-text [writing-mode:vertical-rl]" style={{ transform: "rotate(180deg)" }}>
            {t("likelihoodAxis")}
          </span>
        </div>
        <div>
          <table className="border-collapse">
            <caption className="sr-only">{t("title")}</caption>
            <tbody>
              {LIKELIHOOD_ROWS.map((likelihood) => (
                <tr key={likelihood}>
                  <th scope="row" className="w-8 border border-k-grey px-s-1 text-fs-12 text-k-text num">
                    {likelihood}
                  </th>
                  {LEVELS.map((impact) => {
                    const count = countAt(risks, likelihood, impact);
                    const band = scoreBand(likelihood * impact);
                    const bandLabel = t(BAND_KEY[band]);
                    // RULE (build brief): never colour alone — the cell's
                    // aria-label always carries the count and the band word,
                    // whatever colour the tint is.
                    const label = t("cellLabel", { likelihood, impact, count, band: bandLabel });
                    return (
                      <td
                        key={impact}
                        role="img"
                        aria-label={label}
                        className={`h-10 w-10 border border-k-grey text-center text-fs-14 num ${BAND_BG[band]} ${count > 0 ? "text-k-ink" : "text-k-text-muted"}`}
                      >
                        {count > 0 ? count : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row" aria-hidden="true" className="border-0" />
                {LEVELS.map((impact) => (
                  <td key={impact} className="pt-s-1 text-center text-fs-12 text-k-text num">
                    {impact}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="mt-s-1 text-center text-fs-14 text-k-text">{t("impactAxis")}</p>
        </div>
      </div>
    </div>
  );
}
