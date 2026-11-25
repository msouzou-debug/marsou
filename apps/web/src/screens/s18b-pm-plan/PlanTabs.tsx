"use client";

// S18b — the two views of «Προληπτική συντήρηση»: every agreement at once
// (the default) and one unit's agreement, catalogue and programme. Links,
// so each view is a URL and the browser's back button returns to the
// filtered dashboard (ProjectTabs' shape).
//
// | Prop   | Type                       | Notes |
// |--------|----------------------------|-------|
// | active | "dashboard" \| "agreement" |       |
import Link from "next/link";
import { useTranslations } from "next-intl";

export type PlanTabId = "dashboard" | "agreement";

const TABS: Array<{ id: PlanTabId; href: string }> = [
  { id: "dashboard", href: "/maintenance/plan" },
  { id: "agreement", href: "/maintenance/plan?view=agreement" },
];

export function PlanTabs({ active }: { active: PlanTabId }) {
  const t = useTranslations("screens.s18plan.tabs");
  return (
    <div role="tablist" aria-label={t("label")} className="mb-s-5 flex flex-wrap gap-s-2 border-b border-k-grey">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            role="tab"
            aria-selected={isActive}
            className={isActive ? "border-b-2 border-k-blue-deep px-s-3 py-s-2 text-fs-14 font-bold text-k-blue-deep" : "px-s-3 py-s-2 text-fs-14 text-k-text"}
          >
            {t(tab.id)}
          </Link>
        );
      })}
    </div>
  );
}
