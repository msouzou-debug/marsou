"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "@/i18n/actions";
import { locales, type Locale } from "@/i18n/config";

// Top-bar EL / EN segmented control. Same setLocale + router.refresh pattern
// as src/app/preview/locale-switch.tsx (ADR-0002): the cookie changes and
// the page refreshes, no route change, no full reload.
export function LanguageToggle() {
  const current = useLocale() as Locale;
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      role="group"
      aria-label={t("language")}
      className="inline-flex shrink-0 overflow-hidden rounded-k border border-k-grey"
    >
      {locales.map((locale) => (
        <button
          key={locale}
          type="button"
          aria-pressed={locale === current}
          disabled={pending}
          onClick={() => {
            if (locale === current) return;
            startTransition(async () => {
              await setLocale(locale);
              router.refresh();
            });
          }}
          className={`px-s-3 py-s-1 text-fs-14 font-bold uppercase ${
            locale === current ? "bg-k-blue-deep text-k-white" : "bg-k-white text-k-text hover:bg-k-surface"
          }`}
        >
          {locale}
        </button>
      ))}
    </div>
  );
}
