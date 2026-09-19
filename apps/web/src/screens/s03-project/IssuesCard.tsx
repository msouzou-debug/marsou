"use client";

// S03 — R05
//
// «Θέματα» card (UI instructions §5): count of open issues, next due date.

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Issue } from "@ecapital/shared";
import { formatDate } from "@/lib/format";

export interface IssuesCardProps {
  projectId: string;
  issues: Issue[];
}

export function IssuesCard({ projectId, issues }: IssuesCardProps) {
  const t = useTranslations();
  const open = issues.filter((issue) => issue.status === "OPEN");
  const nextDue = [...open]
    .filter((issue): issue is Issue & { dueDate: string } => issue.dueDate !== null)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <div className="flex items-center justify-between gap-s-3">
        <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s03.issuesTitle")}</h2>
        {/* RULE: S06 holds the full register (open and resolved) — this card
            only summarises open issues, so it always links out. */}
        <Link
          href={`/projects/${encodeURIComponent(projectId)}/risks`}
          className="text-fs-14 font-bold text-k-blue-deep underline-offset-2 hover:underline"
        >
          {t("screens.s03.issuesViewAll")}
        </Link>
      </div>
      {open.length === 0 ? (
        <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s03.issuesEmpty")}</p>
      ) : (
        <>
          <p className="mt-s-1 text-fs-14 text-k-text">{t("screens.s03.issuesOpenSummary", { count: open.length })}</p>
          {nextDue && (
            <p className="num mt-s-1 text-fs-14 text-k-text">
              {t("screens.s03.issuesNextDue", { date: formatDate(nextDue.dueDate) })}
            </p>
          )}
        </>
      )}
    </section>
  );
}
