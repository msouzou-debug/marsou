"use client";

// S18b agreements dashboard
//
// ExpiryChip — how close an agreement is to its end: «Σε ισχύ», «Λήγει σε
// ≤ 90 ημέρες», «Έληξε». The text label is always rendered (UI instructions
// §4: never colour alone); the tint only helps the eye. The band comes from
// the API (`agreementExpiryBand`), so the chip and the filter agree.
//
// | Prop | Type                | Notes |
// |------|---------------------|-------|
// | band | AgreementExpiryBand |       |
import { useTranslations } from "next-intl";
import type { AgreementExpiryBand } from "@ecapital/shared";

const STYLE: Record<AgreementExpiryBand, string> = {
  OK: "bg-k-green-bg",
  EXPIRING: "bg-k-amber-bg",
  EXPIRED: "bg-k-red-bg",
};

export function ExpiryChip({ band }: { band: AgreementExpiryBand }) {
  const t = useTranslations("screens.s18plan.dashboard.band");
  return <span className={`inline-flex items-center whitespace-nowrap rounded-k-chip px-s-2 py-s-1 text-fs-14 text-k-ink ${STYLE[band]}`}>{t(band)}</span>;
}
