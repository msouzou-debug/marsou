// S06 — R07
//
// Pure helper for the Προθεσμία column: an issue is overdue only while it is
// still OPEN and its due date has passed — a RESOLVED issue past its old
// due date is not a problem any more.
import type { Issue } from "@ecapital/shared";

export function isIssueOverdue(issue: Issue, today: Date): boolean {
  return issue.status === "OPEN" && issue.dueDate !== null && new Date(issue.dueDate) < today;
}
