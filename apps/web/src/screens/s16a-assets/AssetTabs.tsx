"use client";

// S16a/S17c — R26–R30, R45 (M4 build brief item 6: "tab next to the register")
//
// AssetTabs — Μητρώο παγίων (S16a, `/assets`) and Πρόβλεψη αντικαταστάσεων
// (S17c, `/assets/forecast`). Same pattern `s11-permits/PermitTabs.tsx`
// documents: real links with `aria-current`, not buttons swapping a panel.
//
// RULE (build brief item 6, persona estates_head/finance/executive_readonly/
// admin): the forecast tab is omitted, not disabled, for a role it is not
// for — same "hide with a reason, or don't offer" idea UI instructions §6
// gives write controls, applied here to a read-only tab a role's own 403
// would otherwise greet them with.
import Link from "next/link";
import { useTranslations } from "next-intl";

export interface AssetTabsProps {
  active: "register" | "forecast";
  canViewForecast: boolean;
}

export function AssetTabs({ active, canViewForecast }: AssetTabsProps) {
  const t = useTranslations("components.asset-tabs");

  const tabs = [
    { id: "register" as const, href: "/assets", label: t("register") },
    ...(canViewForecast ? [{ id: "forecast" as const, href: "/assets/forecast", label: t("forecast") }] : []),
  ];

  if (tabs.length < 2) return null;

  return (
    <nav aria-label={t("label")} className="mb-s-5 border-b border-k-grey">
      <ul className="flex flex-wrap gap-s-1">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <Link
              href={tab.href}
              aria-current={active === tab.id ? "page" : undefined}
              className={
                active === tab.id
                  ? "flex min-h-[44px] items-center border-b-2 border-k-blue px-s-4 text-fs-16 font-bold text-k-blue-deep"
                  : "flex min-h-[44px] items-center border-b-2 border-transparent px-s-4 text-fs-16 text-k-text hover:text-k-ink"
              }
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
