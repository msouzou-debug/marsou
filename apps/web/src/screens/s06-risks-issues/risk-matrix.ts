// S06 — R07 (Risk and issue registers per project)
//
// Pure helpers for the 5×5 likelihood × impact matrix: the score band and
// the per-cell count, kept apart from `RiskMatrix.tsx` so the banding rule
// is unit-tested without rendering the grid.
import type { Risk } from "@ecapital/shared";

export type ScoreBand = "LOW" | "MEDIUM" | "HIGH";

/** RULE (build brief): ≤ 4 low, 5–12 medium, > 12 high (max score 5×5=25). */
export function scoreBand(score: number): ScoreBand {
  if (score <= 4) return "LOW";
  if (score <= 12) return "MEDIUM";
  return "HIGH";
}

export function riskScore(risk: Pick<Risk, "likelihood" | "impact">): number {
  return risk.likelihood * risk.impact;
}

/** How many risks sit at exactly (likelihood, impact). */
export function countAt(risks: Array<Pick<Risk, "likelihood" | "impact">>, likelihood: number, impact: number): number {
  return risks.filter((risk) => risk.likelihood === likelihood && risk.impact === impact).length;
}
