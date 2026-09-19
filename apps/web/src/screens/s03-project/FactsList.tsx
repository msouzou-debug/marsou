"use client";

// S03 — R04, R05, R07
//
// The left column's definition list (UI instructions §5 "left facts and
// Timeline"). One row per fact the brief lists; the revised and actual dates
// only appear "when present" — a null date is not shown as a row at all,
// rather than as a row reading «—», since the brief's own wording ("when
// present") frames these as facts that may not exist yet, not facts whose
// value is unknown.

import { Fragment, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { ProjectDetail } from "@ecapital/shared";
import { formatDate } from "@/lib/format";

export interface FactsListProps {
  project: ProjectDetail;
  /** RULE (R04): hidden for a role that cannot write the phase (auditor,
   *  executive, clinical_approver, finance — see `ProjectOverview`'s header
   *  comment for the full reasoning), and for a phase with no next (or, for
   *  an admin, previous) phase to move to. Omit or `false` to hide the
   *  button entirely rather than disabling it — there is nothing for a
   *  read-only visitor to be told about a control they were never going to
   *  use, and nothing an admin at CLOSED-with-no-admin-rights-back can do
   *  with it either. */
  canChangePhase?: boolean;
  onChangePhase?: () => void;
  /** UI instructions §6 "Offline": shown, but disabled with the reason in
   *  its own tooltip, rather than hidden — offline is a connectivity fact,
   *  not a permission one. */
  phaseChangeOfflineReason?: string;
}

interface FactRow {
  label: string;
  value: ReactNode;
}

export function FactsList({
  project,
  canChangePhase = false,
  onChangePhase,
  phaseChangeOfflineReason,
}: FactsListProps) {
  const t = useTranslations();
  const dash = t("common.notAvailable");
  const yesNo = (value: boolean) => (value ? t("common.yes") : t("common.no"));

  const rows: FactRow[] = [
    {
      label: t("screens.s03.facts.phase"),
      value: (
        <span className="flex flex-wrap items-center gap-s-3">
          <span>{t(`phases.${project.phase}`)}</span>
          {canChangePhase && (
            <button
              type="button"
              onClick={onChangePhase}
              disabled={!!phaseChangeOfflineReason}
              title={phaseChangeOfflineReason}
              className="text-fs-12 font-bold text-k-blue underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
            >
              {t("buttons.changePhase")}
            </button>
          )}
        </span>
      ),
    },
    { label: t("screens.s03.facts.category"), value: t(`categories.${project.category}`) },
    { label: t("screens.s03.facts.funding"), value: t(`fundingSources.${project.fundingSource}`) },
    { label: t("screens.s03.facts.plannedStart"), value: project.plannedStart ? formatDate(project.plannedStart) : dash },
    { label: t("screens.s03.facts.plannedFinish"), value: project.plannedFinish ? formatDate(project.plannedFinish) : dash },
  ];

  // RULE (UI instructions §5): revised and actual dates only show up once
  // there is one to show.
  if (project.forecastStart) rows.push({ label: t("screens.s03.facts.revisedStart"), value: formatDate(project.forecastStart) });
  if (project.forecastFinish) rows.push({ label: t("screens.s03.facts.revisedFinish"), value: formatDate(project.forecastFinish) });
  if (project.actualStart) rows.push({ label: t("screens.s03.facts.actualStart"), value: formatDate(project.actualStart) });
  if (project.actualFinish) rows.push({ label: t("screens.s03.facts.actualFinish"), value: formatDate(project.actualFinish) });

  rows.push({
    label: t("screens.s03.facts.budgetYears"),
    value: project.budgetYearFrom && project.budgetYearTo ? `${project.budgetYearFrom}–${project.budgetYearTo}` : dash,
  });
  rows.push({ label: t("screens.s03.facts.wbs"), value: project.sapWbs ?? dash });
  rows.push({ label: t("screens.s03.facts.tenderRef"), value: project.tenderReference ?? dash });
  rows.push({ label: t("screens.s03.facts.sponsor"), value: project.sponsorName ?? dash });
  rows.push({ label: t("screens.s03.facts.projectManager"), value: project.projectManagerName ?? dash });
  rows.push({ label: t("screens.s03.facts.article"), value: project.budgetArticle ?? dash });

  rows.push({
    label: t("screens.s03.facts.commitmentFlag"),
    value: (
      <>
        {yesNo(project.commitmentFlag)}
        {project.commitmentFlag && project.commitmentNote && (
          <span className="mt-s-1 block text-fs-12 text-k-text">{project.commitmentNote}</span>
        )}
      </>
    ),
  });
  rows.push({
    label: t("screens.s03.facts.actionPlan"),
    value: (
      <>
        {yesNo(project.actionPlanRef !== null)}
        {project.actionPlanRef && <span className="mt-s-1 block text-fs-12 text-k-text">{project.actionPlanRef}</span>}
      </>
    ),
  });
  rows.push({ label: t("screens.s03.facts.contractualCommitment"), value: yesNo(project.contractualCommitment) });

  return (
    <>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-s-4 gap-y-s-2 text-fs-14">
        {rows.map((row, index) => (
          <Fragment key={index}>
            <dt className="text-k-text">{row.label}</dt>
            <dd className="text-k-ink">{row.value}</dd>
          </Fragment>
        ))}
      </dl>
      {project.noteEl && <p className="mt-s-4 text-fs-14 text-k-text">{project.noteEl}</p>}
    </>
  );
}
