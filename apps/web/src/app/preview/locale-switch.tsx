"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "@/i18n/actions";
import { locales, type Locale } from "@/i18n/config";

// Minimal EL / EN segmented control for the gallery. The product's own toggle
// lives in the top bar (app shell) and reuses setLocale.
export function LocaleSwitch() {
  const current = useLocale() as Locale;
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="group" aria-label="Language" className="inline-flex rounded-k border border-k-grey overflow-hidden">
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={l === current}
          disabled={pending}
          onClick={() => start(async () => { await setLocale(l); router.refresh(); })}
          className={`px-s-3 py-s-1 text-fs-14 uppercase ${l === current ? "bg-k-blue-deep text-k-white" : "bg-k-white text-k-text"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
