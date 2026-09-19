"use client";

// S03, S05, S06 — R03, R04, R06, R07
//
/**
 * ProjectTabs — the tab strip a project's own screens share (S03 Επισκόπηση,
 * S05 Χρονοδιάγραμμα, S06 Κίνδυνοι και θέματα, and S04 Κόστος once M2 ships
 * it). One component so the four tabs and their order live in one place —
 * before this, `ProjectOverview.tsx` built its own strip inline with the
 * other three permanently `disabled`, which stopped being true the moment
 * S05 and S06 got their own pages.
 *
 * | Prop      | Type                                              | Notes                                    |
 * |-----------|---------------------------------------------------|---------------------------------------------|
 * | projectId | string                                             | Builds each tab's `href`.                    |
 * | active    | "overview" \| "schedule" \| "risksIssues"          | Which tab is the current page; `cost` is never active — it has no page yet. |
 *
 * RULE: Κόστος (S04) stays a disabled button with a tooltip until M2 — the
 * build brief only asks for S05 and S06 here.
 */

import Link from "next/link";
import { useTranslations } from "next-intl";

export type ProjectTabId = "overview" | "schedule" | "risksIssues";

export interface ProjectTabsProps {
  projectId: string;
  active: ProjectTabId;
}

const LIVE_TABS: Array<{ id: ProjectTabId; href: (projectId: string) => string }> = [
  { id: "overview", href: (id) => `/projects/${encodeURIComponent(id)}` },
  { id: "schedule", href: (id) => `/projects/${encodeURIComponent(id)}/schedule` },
  { id: "risksIssues", href: (id) => `/projects/${encodeURIComponent(id)}/risks` },
];

export function ProjectTabs({ projectId, active }: ProjectTabsProps) {
  const t = useTranslations();

  return (
    <div role="tablist" aria-label={t("screens.s03.tabs.overview")} className="flex flex-wrap gap-s-2 border-b border-k-grey">
      {LIVE_TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href(projectId)}
            role="tab"
            aria-selected={isActive}
            className={
              isActive
                ? "border-b-2 border-k-blue-deep px-s-3 py-s-2 text-fs-14 font-bold text-k-blue-deep"
                : "px-s-3 py-s-2 text-fs-14 text-k-text"
            }
          >
            {t(`screens.s03.tabs.${tab.id}`)}
          </Link>
        );
      })}
      <button
        type="button"
        role="tab"
        aria-selected="false"
        disabled
        title={t("screens.s03.tabsDisabledTooltip")}
        className="px-s-3 py-s-2 text-fs-14 text-k-text disabled:opacity-50"
      >
        {t("screens.s03.tabs.cost")}
      </button>
    </div>
  );
}
