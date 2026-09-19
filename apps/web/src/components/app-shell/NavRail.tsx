"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AppRole } from "@ecapital/shared";
import { NAV_ITEMS } from "./nav-items";

export interface NavRailProps {
  /** Count for the Εγκρίσεις (approvals) badge. 0 hides the badge. */
  approvalsCount?: number;
  /** `me.roles` — hides a `visibleFor`-gated item (M2's «Κόστος») for a caller it excludes. Omitted (or empty) hides every gated item. */
  roles?: AppRole[];
}

// Desktop (≥1440): 240px, icon + label. Tablet (1024–1439): 56px, icon only
// with a tooltip on hover/focus (UI instructions §2). Hidden below 1024 —
// phone uses BottomTabBar instead.
//
// RULE: the active item is --k-blue-deep text on a --k-blue-bg background,
// never a filled blue element — the rail never uses --k-blue as a fill (UI
// instructions §1: at most one filled-blue element per view, the primary
// button, and this is not it).
export function NavRail({ approvalsCount = 0, roles = [] }: NavRailProps) {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("shell.primaryNav")}
      className="hidden w-14 shrink-0 flex-col gap-s-1 border-r border-k-grey bg-k-white py-s-4 tablet:flex desktop:w-60"
    >
      {NAV_ITEMS.filter((item) => !item.visibleFor || item.visibleFor(roles)).map((item) => {
        const Icon = item.icon;
        const active = item.href === "/" ? pathname === "/" : (pathname ?? "").startsWith(item.href);
        const label = t(item.labelKey);
        const badge = item.hasBadge && approvalsCount > 0 ? approvalsCount : undefined;

        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`group relative mx-s-2 flex items-center justify-center gap-s-3 rounded-k px-s-3 py-s-2 text-fs-14 desktop:justify-start ${
              active ? "bg-k-blue-bg font-bold text-k-blue-deep" : "text-k-text hover:bg-k-surface"
            }`}
          >
            <span className="relative inline-flex shrink-0">
              <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
              {badge ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1.5 -top-1.5 flex min-w-[16px] items-center justify-center rounded-full bg-k-ink px-1 text-fs-12 leading-[16px] text-k-white"
                >
                  {badge}
                </span>
              ) : null}
            </span>
            {/* Always in the accessibility tree, regardless of breakpoint —
                the "hidden" utility below removes content from a11y too. */}
            <span className="sr-only">
              {label}
              {badge ? ` — ${t("shell.approvalsWaiting", { count: badge })}` : ""}
            </span>
            <span aria-hidden="true" className="hidden desktop:inline">
              {label}
            </span>
            {/* Icon-only mode tooltip: CSS-only, shows on hover or keyboard focus. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-full top-1/2 z-10 ml-s-2 -translate-y-1/2 whitespace-nowrap rounded-k bg-k-ink px-s-2 py-s-1 text-fs-12 text-k-white opacity-0 shadow-k group-focus-visible:opacity-100 group-hover:opacity-100 desktop:hidden"
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
