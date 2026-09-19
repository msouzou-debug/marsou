"use client";

// S07 — R10
//
// The contract's variations, compact, each one a shortcut into S08 (build
// brief §5 "Then the variations list (link to S08)"). `ContractDetail`
// already carries the full list in one call, so this reads `contract.variations`
// directly rather than fetching S08's own list a second time.

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Variation } from "@ecapital/shared";
import { formatEUR } from "@/lib/format";

export interface VariationsListProps {
  contractId: string;
  variations: Variation[];
}

export function VariationsList({ contractId, variations }: VariationsListProps) {
  const t = useTranslations();
  const href = `/contracts/${encodeURIComponent(contractId)}/variations`;
  const sorted = [...variations].sort((a, b) => b.number - a.number);

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <div className="flex items-center justify-between gap-s-3">
        <h2 className="text-fs-16 font-bold text-k-blue-deep">
          <Link href={href} className="underline-offset-2 hover:underline">
            {t("screens.s07.variationsTitle")}
          </Link>
        </h2>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s07.variationsEmpty")}</p>
      ) : (
        <>
          <ul className="mt-s-3 grid gap-s-2">
            {sorted.slice(0, 5).map((variation) => (
              <li
                key={variation.id}
                className="flex items-center justify-between gap-s-3 border-t border-k-grey pt-s-2 first:border-t-0 first:pt-0"
              >
                <div>
                  <span className="num text-fs-12 text-k-text-muted">#{variation.number}</span>{" "}
                  <span className={`text-fs-14 ${variation.status === "SUBMITTED" ? "font-bold text-k-ink" : "text-k-ink"}`}>
                    {variation.descriptionEl}
                  </span>
                  <p className="text-fs-12 text-k-text">{t(`variationStatus.${variation.status}`)}</p>
                </div>
                <span className={`num text-fs-14 ${variation.value < 0 ? "text-k-red" : "text-k-ink"}`}>
                  {formatEUR(variation.value)}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href={href}
            className="mt-s-3 inline-block text-fs-14 font-bold text-k-blue-deep underline-offset-2 hover:underline"
          >
            {t("screens.s07.variationsViewAll")}
          </Link>
        </>
      )}
    </section>
  );
}
