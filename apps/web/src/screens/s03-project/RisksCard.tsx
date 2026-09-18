"use client";

// S03 — R05
//
// «Κίνδυνοι» card (UI instructions §5): count of open risks, top three by
// likelihood × impact.

import { useTranslations } from "next-intl";
import type { Risk } from "@ecapital/shared";

export interface RisksCardProps {
  risks: Risk[];
}

export function RisksCard({ risks }: RisksCardProps) {
  const t = useTranslations();
  const open = risks.filter((risk) => risk.status === "OPEN");
  const top3 = [...open].sort((a, b) => b.likelihood * b.impact - a.likelihood * a.impact).slice(0, 3);

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s03.risksTitle")}</h2>
      {open.length === 0 ? (
        <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s03.risksEmpty")}</p>
      ) : (
        <>
          <p className="mt-s-1 text-fs-14 text-k-text">{t("screens.s03.risksOpenSummary", { count: open.length })}</p>
          <ul className="mt-s-2 grid gap-s-2">
            {top3.map((risk) => (
              <li key={risk.id} className="border-t border-k-grey pt-s-2 first:border-t-0 first:pt-0">
                <p className="text-fs-14 text-k-ink">{risk.descriptionEl}</p>
                <p className="num mt-s-1 text-fs-12 text-k-text">
                  {t("screens.s03.riskScore", { likelihood: risk.likelihood, impact: risk.impact })}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
