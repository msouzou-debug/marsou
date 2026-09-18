"use client";

// S01 — R03

/**
 * ExceptionList — S01's «Χρειάζονται προσοχή» panel (UI instructions §5).
 *
 * | Prop     | Type                | Notes                                                |
 * |----------|---------------------|--------------------------------------------------------|
 * | items    | Exception[]         | Already capped at 8 by the API schema; sliced again here for safety. |
 * | loading  | boolean             | Skeleton lines while the portfolio query is in flight. |
 *
 * RULE: when there is nothing to flag the panel still renders — one sentence
 * saying so — never an empty card (UI instructions §5, §6).
 */

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { Exception } from "@ecapital/shared";
import type { Locale } from "@/i18n/config";
import { RagChip } from "@/components/rag-chip";

export interface ExceptionListProps {
  items: Exception[];
  loading?: boolean;
}

export function ExceptionList({ items, loading = false }: ExceptionListProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const shown = items.slice(0, 8);

  return (
    <div className="rounded-k border border-k-grey bg-k-white p-s-6">
      <h2 className="text-fs-20">{t("screens.s01.exceptions.title")}</h2>

      {loading ? (
        <ul aria-busy="true" className="mt-s-4 grid gap-s-3">
          <span className="sr-only">{t("common.loading")}</span>
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} aria-hidden="true" className="h-[16px] w-full animate-pulse rounded-k-chip bg-k-grey" />
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <p className="mt-s-4 text-fs-16 text-k-text">{t("screens.s01.exceptions.empty")}</p>
      ) : (
        <ul className="mt-s-4 grid gap-s-4">
          {shown.map((item) => (
            <li key={item.id} className="flex items-start gap-s-2">
              <RagChip value={item.severity} variant="label" />
              <Link href={item.href} className="text-fs-14 text-k-text underline-offset-2 hover:underline">
                {locale === "en" ? item.sentenceEn : item.sentenceEl}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
