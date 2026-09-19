"use client";

// S06 — R07
//
// The phone layout for the risk register (UI instructions §2): compact
// cards instead of `Table`'s row-per-line grid, the same pattern S02's
// `ProjectCards` uses for the same reason — `Table` has no card variant of
// its own. A second, phone-only rendering of the same rows sitting next to
// the desktop table (`RisksIssues.tsx` toggles which one shows).
import { useTranslations } from "next-intl";
import type { Risk } from "@ecapital/shared";

export interface RiskCardsProps {
  risks: Risk[];
  onOpen: (risk: Risk) => void;
}

export function RiskCards({ risks, onOpen }: RiskCardsProps) {
  const t = useTranslations();

  return (
    <ul className="grid gap-s-3">
      {risks.map((risk) => (
        <li key={risk.id}>
          <button
            type="button"
            onClick={() => onOpen(risk)}
            className="block w-full rounded-k border border-k-grey bg-k-white p-s-4 text-left shadow-k"
          >
            <p className="text-fs-16 text-k-ink">{risk.descriptionEl}</p>
            <div className="mt-s-2 flex items-center justify-between gap-s-2 text-fs-14 text-k-text">
              {/* Same phrasing S03's own RisksCard uses for the same figure. */}
              <span className="num">{t("screens.s03.riskScore", { likelihood: risk.likelihood, impact: risk.impact })}</span>
              <span>{t(`riskStatus.${risk.status}`)}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
