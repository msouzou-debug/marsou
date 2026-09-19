"use client";

// S03 — R04
//
// «Ορόσημα» card (UI instructions §5): title, baseline, forecast, actual,
// gate icon; an overdue forecast (no actual date, forecast in the past) is
// never colour alone — the red text carries an icon and the SLA glossary's
// own «Εκπρόθεσμο» label (UI instructions §4, RagChip's own rule reused here
// for the same reason).

import { Flag, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Milestone } from "@ecapital/shared";
import { formatDate } from "@/lib/format";

export interface MilestonesCardProps {
  milestones: Milestone[];
  /** Injectable for tests; defaults to "now" for the real screen. */
  today?: Date;
}

function isOverdue(milestone: Milestone, today: Date): boolean {
  return milestone.actualDate === null && milestone.forecastDate !== null && new Date(milestone.forecastDate) < today;
}

export function MilestonesCard({ milestones, today = new Date() }: MilestonesCardProps) {
  const t = useTranslations();
  const dash = t("common.notAvailable");
  const sorted = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s03.milestonesTitle")}</h2>
      {sorted.length === 0 ? (
        <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s03.milestonesEmpty")}</p>
      ) : (
        <ul className="mt-s-3 grid gap-s-3">
          {sorted.map((milestone) => {
            const overdue = isOverdue(milestone, today);
            return (
              <li
                key={milestone.id}
                // RULE (R04): the target of the phase-change dialog's
                // gateOpen link (`PhaseDialog`) — a stable anchor per
                // milestone, not styled, so it costs nothing when unused.
                id={`milestone-${milestone.id}`}
                className="scroll-mt-s-4 border-t border-k-grey pt-s-2 first:border-t-0 first:pt-0"
              >
                <div className="flex items-center gap-s-2">
                  <span className="text-fs-14 text-k-ink">{milestone.titleEl}</span>
                  {milestone.isGate && (
                    <span
                      className="inline-flex items-center gap-s-1 text-fs-12 text-k-blue-deep"
                      title={t("screens.s03.gateLabel")}
                    >
                      <Flag size={16} strokeWidth={1.5} aria-hidden="true" />
                      {t("screens.s03.gateLabel")}
                    </span>
                  )}
                </div>
                <div className="mt-s-1 grid grid-cols-3 gap-s-2">
                  <span className="text-fs-12">
                    <span className="block text-k-text">{t("screens.s03.milestoneBaseline")}</span>
                    <span className="num block text-k-ink">{formatDate(milestone.baselineDate)}</span>
                  </span>
                  <span className="text-fs-12">
                    <span className="block text-k-text">{t("screens.s03.milestoneForecast")}</span>
                    <span className={`num block ${overdue ? "text-k-red" : "text-k-ink"}`}>
                      {milestone.forecastDate ? formatDate(milestone.forecastDate) : dash}
                    </span>
                  </span>
                  <span className="text-fs-12">
                    <span className="block text-k-text">{t("screens.s03.milestoneActual")}</span>
                    <span className="num block text-k-ink">{milestone.actualDate ? formatDate(milestone.actualDate) : dash}</span>
                  </span>
                </div>
                {overdue && (
                  <p className="mt-s-1 flex items-center gap-s-1 text-fs-12 text-k-red">
                    <TriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                    {t("components.slaChip.breached")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
