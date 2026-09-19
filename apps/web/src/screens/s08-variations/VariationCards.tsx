"use client";

// S08 — R10 (nit 2)
//
// The phone layout for the variations list (< 1024px): compact cards —
// number, description, value, status chip, decision line — instead of
// `Table`'s row-per-line grid, the same `tablet:hidden`/`hidden tablet:block`
// split S02's `ProjectCards` and S06's `RiskCards`/`IssueCards` use next to
// their own `Table`.

import { useTranslations } from "next-intl";
import type { Variation } from "@ecapital/shared";
import { formatDate, formatEUR } from "@/lib/format";

export interface VariationCardsProps {
  variations: Variation[];
  onOpen: (variation: Variation) => void;
}

const STATUS_CHIP: Record<Variation["status"], string> = {
  DRAFT: "bg-k-grey text-k-ink",
  SUBMITTED: "bg-k-amber-bg text-k-ink",
  APPROVED: "bg-k-green-bg text-k-ink",
  RETURNED: "bg-k-amber-bg text-k-ink",
  REJECTED: "bg-k-red-bg text-k-ink",
};

export function VariationCards({ variations, onOpen }: VariationCardsProps) {
  const t = useTranslations();

  return (
    <ul className="grid gap-s-3">
      {variations.map((variation) => (
        <li key={variation.id}>
          <button
            type="button"
            onClick={() => onOpen(variation)}
            className="block w-full rounded-k border border-k-grey bg-k-white p-s-4 text-left shadow-k"
          >
            <div className="flex items-start justify-between gap-s-2">
              <span className="num text-fs-12 text-k-text-muted">#{variation.number}</span>
              <span className={`inline-flex items-center rounded-k-chip px-s-2 py-s-1 text-fs-12 ${STATUS_CHIP[variation.status]}`}>
                {t(`variationStatus.${variation.status}`)}
              </span>
            </div>
            <p className="mt-s-1 text-fs-16 text-k-ink">{variation.descriptionEl}</p>
            <p className={`num mt-s-2 text-fs-16 ${variation.value < 0 ? "text-k-red" : "text-k-ink"}`}>
              {formatEUR(variation.value)}
            </p>
            {variation.decidedByName ? (
              <p className="mt-s-1 text-fs-12 text-k-text">
                {variation.decidedByName} · {formatDate(variation.decidedAt ?? "")}
              </p>
            ) : variation.status === "SUBMITTED" ? (
              <p className="mt-s-1 text-fs-12 text-k-text">{t("screens.s08.awaitingDecision")}</p>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
