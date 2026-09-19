"use client";

// S07 — R08, R31
//
// The left column's definition list (build brief §5 "S07–S09 are record
// pages... apply the same care to S07": numbers mono, retention its own
// line, never netted silently — applied here to every money/percentage
// fact, not only the CostBar's).

import { Fragment, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ContractDetail } from "@ecapital/shared";
import { formatDate, formatEURorDash, formatPct } from "@/lib/format";

export interface ContractFactsProps {
  contract: ContractDetail;
  /** Injectable "now" for the expired-bond rule; defaults to the real clock. */
  today?: Date;
}

export function ContractFacts({ contract, today = new Date() }: ContractFactsProps) {
  const t = useTranslations();
  const dash = t("common.notAvailable");

  // RULE (build brief §5): an expired bond is never colour alone — the red
  // text carries a triangle icon and its own word, the same rule
  // `MilestonesCard`'s overdue marker already applies to S03.
  const bondExpired = contract.bondExpiry !== null && new Date(contract.bondExpiry) < today;

  // `numeric` marks the facts that are money, dates, percentages or counts —
  // mono, tabular, right-aligned (CONVENTIONS.md); `type`/`awardDecision`
  // stay plain text, same split S03's own `FactsList` makes.
  const rows: Array<{ label: string; value: ReactNode; numeric?: boolean }> = [
    { label: t("screens.s07.facts.type"), value: t(`contractTypes.${contract.type}`) },
    { label: t("screens.s07.facts.awardDate"), value: formatDate(contract.awardDate), numeric: true },
    {
      label: t("screens.s07.facts.startDate"),
      value: contract.startDate ? formatDate(contract.startDate) : dash,
      numeric: true,
    },
    {
      label: t("screens.s07.facts.completionDate"),
      value: contract.completionDate ? formatDate(contract.completionDate) : dash,
      numeric: true,
    },
    {
      label: t("screens.s07.facts.extensionDays"),
      value: t("common.days", { count: contract.extensionDays }),
      numeric: true,
    },
    // RULE (build brief §5): retention is its own fact — never netted into
    // the value above or below it.
    { label: t("screens.s07.facts.retentionPct"), value: formatPct(contract.retentionPct), numeric: true },
    { label: t("screens.s07.facts.bondValue"), value: formatEURorDash(contract.performanceBondValue), numeric: true },
    {
      label: t("screens.s07.facts.bondExpiry"),
      numeric: true,
      value: contract.bondExpiry ? (
        <span className={`inline-flex items-center gap-s-1 ${bondExpired ? "text-k-red" : "text-k-ink"}`}>
          <span>{formatDate(contract.bondExpiry)}</span>
          {bondExpired && (
            <>
              <TriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>{t("screens.s07.facts.bondExpired")}</span>
            </>
          )}
        </span>
      ) : (
        dash
      ),
    },
    {
      label: t("screens.s07.facts.liquidatedDamages"),
      value: formatEURorDash(contract.liquidatedDamagesPerDay),
      numeric: true,
    },
    {
      label: t("screens.s07.facts.defectsLiabilityMonths"),
      value: t("common.months", { count: contract.defectsLiabilityMonths }),
      numeric: true,
    },
    { label: t("screens.s07.facts.sapPoNumber"), value: contract.sapPoNumber ?? dash },
    // RULE (contract `Contract.awardDecisionDocId`): the award decision
    // document is an M8 feature — this fact is always «—» until then.
    { label: t("screens.s07.facts.awardDecision"), value: dash },
  ];

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-s-4 gap-y-s-2 text-fs-14" aria-label={t("screens.s07.factsCaption")}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          <dt className="text-k-text">{row.label}</dt>
          <dd className={`text-k-ink ${row.numeric ? "num" : ""}`}>{row.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
