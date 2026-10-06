import { describe, expect, it } from "vitest";
import type { AppRole } from "@ecapital/shared";
import {
  canFundBacklog,
  canManageBacklog,
  canManageMaintenanceContract,
  canRaiseWorkOrder,
  canViewScorecard,
  canWorkWorkOrder,
} from "./roles";

const ALL_ROLES: AppRole[] = [
  "admin",
  "estates_head",
  "project_engineer",
  "technician",
  "finance",
  "clinical_approver",
  "executive_readonly",
  "auditor_readonly",
];

const who = (check: (roles: AppRole[]) => boolean) => ALL_ROLES.filter((role) => check([role])).sort();

// ADR-0031 §10, one line per helper.
describe("M5 role helpers", () => {
  it("lets the nursing side raise a call but never work it", () => {
    expect(who(canRaiseWorkOrder)).toEqual(["admin", "clinical_approver", "estates_head", "project_engineer", "technician"]);
    expect(who(canWorkWorkOrder)).toEqual(["admin", "estates_head", "project_engineer", "technician"]);
  });

  it("keeps the agreement, catalogue and programme with head of estates and admin", () => {
    expect(who(canManageMaintenanceContract)).toEqual(["admin", "estates_head"]);
  });

  it("lets the engineer write backlog but only head of estates and admin fund it", () => {
    expect(who(canManageBacklog)).toEqual(["admin", "estates_head", "project_engineer"]);
    expect(who(canFundBacklog)).toEqual(["admin", "estates_head"]);
  });

  it("shows the scorecard to every signed-in role, read-only ones included", () => {
    expect(who(canViewScorecard)).toEqual([...ALL_ROLES].sort());
    expect(canViewScorecard([])).toBe(false);
  });

  it("gives the two read-only roles no write at all", () => {
    for (const role of ["auditor_readonly", "executive_readonly"] as const) {
      expect(canRaiseWorkOrder([role])).toBe(false);
      expect(canWorkWorkOrder([role])).toBe(false);
      expect(canManageBacklog([role])).toBe(false);
    }
  });
});
