import { describe, expect, it } from "vitest";
import type { Issue } from "@ecapital/shared";
import { isIssueOverdue } from "./issue-status";

const today = new Date("2026-09-18T00:00:00.000Z");

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: "ISS-1",
    projectId: "PRJ-1",
    descriptionEl: "Καθυστέρηση αδειοδότησης",
    raisedById: "u1",
    raisedByName: "Α. Δημητρίου",
    dueDate: null,
    status: "OPEN",
    ...overrides,
  };
}

describe("isIssueOverdue", () => {
  it("is overdue when OPEN and the due date has passed", () => {
    expect(isIssueOverdue(issue({ dueDate: "2026-09-01", status: "OPEN" }), today)).toBe(true);
  });

  it("is not overdue once RESOLVED, even past its old due date", () => {
    expect(isIssueOverdue(issue({ dueDate: "2026-09-01", status: "RESOLVED" }), today)).toBe(false);
  });

  it("is not overdue with no due date", () => {
    expect(isIssueOverdue(issue({ dueDate: null }), today)).toBe(false);
  });

  it("is not overdue while the due date is still ahead", () => {
    expect(isIssueOverdue(issue({ dueDate: "2026-10-01", status: "OPEN" }), today)).toBe(false);
  });
});
