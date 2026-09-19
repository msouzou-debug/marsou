"use client";

// S06 — R07
//
// The phone layout for the issue register — see `RiskCards.tsx`'s own
// header comment for why this exists as a second rendering of the same
// rows next to the desktop table.
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import type { Issue } from "@ecapital/shared";
import { formatDate } from "@/lib/format";
import { isIssueOverdue } from "./issue-status";

export interface IssueCardsProps {
  issues: Issue[];
  onOpen: (issue: Issue) => void;
  today?: Date;
}

export function IssueCards({ issues, onOpen, today = new Date() }: IssueCardsProps) {
  const t = useTranslations();

  return (
    <ul className="grid gap-s-3">
      {issues.map((issue) => {
        const overdue = isIssueOverdue(issue, today);
        return (
          <li key={issue.id}>
            <button
              type="button"
              onClick={() => onOpen(issue)}
              className="block w-full rounded-k border border-k-grey bg-k-white p-s-4 text-left shadow-k"
            >
              <p className="text-fs-16 text-k-ink">{issue.descriptionEl}</p>
              <div className="mt-s-2 flex items-center justify-between gap-s-2 text-fs-14">
                <span className={`inline-flex items-center gap-s-1 num ${overdue ? "text-k-red" : "text-k-text"}`}>
                  {overdue && <TriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" />}
                  {issue.dueDate ? formatDate(issue.dueDate) : t("common.notAvailable")}
                </span>
                <span className="text-k-text">{t(`issueStatus.${issue.status}`)}</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
