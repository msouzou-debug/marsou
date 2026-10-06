"use client";

// S18–S20, S18b, S22 — R32, R33
//
// BandChip — the contract's priority band («Κρίσιμης λειτουργίας»,
// «Προτεραιότητας 1», «Προτεραιότητας 2») as a chip. The text label is
// always rendered (UI instructions §4: never colour alone); the tint only
// helps the eye. A null band (an order with no catalogue system) is «—».
//
// | Prop | Type           | Notes |
// |------|----------------|-------|
// | band | SlaBand\|null  |       |
import { useTranslations } from "next-intl";
import type { SlaBand } from "@ecapital/shared";

const STYLE: Record<SlaBand, string> = {
  CRITICAL: "bg-k-red-bg",
  P1: "bg-k-amber-bg",
  P2: "bg-k-blue-bg",
};

export function BandChip({ band }: { band: SlaBand | null }) {
  const t = useTranslations("slaBand");
  if (!band) return <span className="text-fs-14 text-k-text">—</span>;
  return <span className={`inline-flex items-center rounded-k-chip px-s-2 py-s-1 text-fs-14 text-k-ink ${STYLE[band]}`}>{t(band)}</span>;
}
