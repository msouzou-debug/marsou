"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface AssetBreadcrumbSegment {
  /** The value shown as the link text — e.g. the hospital name, "Κτίριο Α", "2ος", "Θάλαμος 214". */
  value: string;
  href: string;
}

// Fixed hierarchy, in order (UI instructions §4 / CAPEX-02 §5): Μονάδα ›
// Κτίριο › Όροφος › Χώρος › Πάγιο. Not configurable — a caller supplies the
// per-level value, never the level name.
const LEVEL_KEYS = ["unit", "building", "floor", "room", "asset"] as const;

/**
 * AssetBreadcrumb — Μονάδα › Κτίριο › Όροφος › Χώρος › Πάγιο, each segment a
 * link (UI instructions §4 AssetBreadcrumb, used by S16/S17).
 *
 * | Prop     | Type                     | Notes                                                   |
 * |----------|--------------------------|------------------------------------------------------------|
 * | segments | AssetBreadcrumbSegment[] | Up to 5, in hierarchy order, one per fixed level above     |
 *
 * RULE: the first level is the org unit — a hospital, a service (ΔΥΨΥ, ΠΦΥ)
 * or Κεντρικά Γραφεία — so its level label is «Μονάδα», never «Νοσοκομείο». The
 * level label is not shown as visible text (the visible text is the actual
 * value, e.g. the hospital name) but is carried in each link's accessible
 * name, so assistive tech and tests can see it is «Μονάδα», not «Νοσοκομείο».
 *
 * On phone, middle segments collapse to «…» and only the first and last stay
 * visible — done with CSS breakpoints, not JS, since "phone" is the default.
 *
 * State: default only — a caller passes the resolved path once known.
 */
export interface AssetBreadcrumbProps {
  segments: AssetBreadcrumbSegment[];
}

export function AssetBreadcrumb({ segments }: AssetBreadcrumbProps) {
  const t = useTranslations();
  const levelLabels = LEVEL_KEYS.map((key) =>
    key === "unit" ? t("common.unit") : t(`components.asset-breadcrumb.levels.${key}`),
  );

  const first = segments[0];
  const last = segments[segments.length - 1];
  const middles = segments.slice(1, -1);

  const chevron = (
    <ChevronRight size={20} strokeWidth={1.5} aria-hidden="true" className="text-k-text-muted shrink-0" />
  );

  function link(segment: AssetBreadcrumbSegment, levelIndex: number) {
    return (
      <Link href={segment.href} aria-label={`${levelLabels[levelIndex]}: ${segment.value}`} className="text-k-blue hover:underline">
        {segment.value}
      </Link>
    );
  }

  return (
    <nav aria-label={t("common.unit")}>
      <ol className="flex flex-wrap items-center gap-s-2 text-fs-14">
        {first && <li className="flex items-center gap-s-2">{link(first, 0)}</li>}

        {/* RULE (phone): collapse every middle segment into one "…" so the
            trail still fits on a small screen; tablet/desktop show them all. */}
        {middles.length > 0 && (
          <li aria-hidden="true" className="flex items-center gap-s-2 text-k-text-muted tablet:hidden">
            {chevron}
            <span>{t("components.asset-breadcrumb.collapsed")}</span>
          </li>
        )}

        {middles.map((segment, mi) => (
          <li key={segment.href} className="hidden items-center gap-s-2 tablet:flex">
            {chevron}
            {link(segment, mi + 1)}
          </li>
        ))}

        {segments.length > 1 && (
          <li className="flex items-center gap-s-2">
            {chevron}
            {link(last, segments.length - 1)}
          </li>
        )}
      </ol>
    </nav>
  );
}
