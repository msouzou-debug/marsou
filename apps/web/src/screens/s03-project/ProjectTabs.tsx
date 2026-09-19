"use client";

// S03, S04, S05, S06 — R03, R04, R06, R07, R13
//
/**
 * ProjectTabs — the tab strip a project's own screens share (S03 Επισκόπηση,
 * S04 Κόστος, S05 Χρονοδιάγραμμα, S06 Κίνδυνοι και θέματα). One component so
 * the four tabs and their order live in one place — before M2, `cost` was a
 * permanently `disabled` button with a tooltip; it is a real link now that
 * S04 has a page.
 *
 * | Prop      | Type                                                 | Notes                 |
 * |-----------|------------------------------------------------------|--------------------------|
 * | projectId | string                                                | Builds each tab's `href`. |
 * | active    | "overview" \| "cost" \| "schedule" \| "risksIssues"   | Which tab is the current page. |
 */

import Link from "next/link";
import { useTranslations } from "next-intl";

export type ProjectTabId = "overview" | "cost" | "schedule" | "risksIssues";

export interface ProjectTabsProps {
  projectId: string;
  active: ProjectTabId;
}

const TABS: Array<{ id: ProjectTabId; href: (projectId: string) => string }> = [
  { id: "overview", href: (id) => `/projects/${encodeURIComponent(id)}` },
  { id: "cost", href: (id) => `/projects/${encodeURIComponent(id)}/cost` },
  { id: "schedule", href: (id) => `/projects/${encodeURIComponent(id)}/schedule` },
  { id: "risksIssues", href: (id) => `/projects/${encodeURIComponent(id)}/risks` },
];

export function ProjectTabs({ projectId, active }: ProjectTabsProps) {
  const t = useTranslations();

  return (
    <div role="tablist" aria-label={t("screens.s03.tabs.overview")} className="flex flex-wrap gap-s-2 border-b border-k-grey">
      {TABS.map((tab) => {
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
    </div>
  );
}
