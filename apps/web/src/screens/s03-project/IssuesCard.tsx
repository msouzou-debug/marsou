"use client";

// S03 — R05
//
// «Θέματα» card (UI instructions §5): count of open issues, next due date.

import { useTranslations } from "next-intl";
import type { Issue } from "@ecapital/shared";
import { formatDate } from "@/lib/format";

export interface IssuesCardProps {
  issues: Issue[];
}

export function IssuesCard({ issues }: IssuesCardProps) {
  const t = useTranslations();
  const open = issues.filter((issue) => issue.status === "OPEN");
  const nextDue = [...open]
    .filter((issue): issue is Issue & { dueDate: string } => issue.dueDate !== null)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s03.issuesTitle")}</h2>
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
