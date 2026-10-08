import { describe, expect, it } from "vitest";
import { AppRole } from "./auth";
import {
  AccessLevel,
  GENERAL_NOTES,
  MATRIX_GROUPS,
  MATRIX_ROLES,
  MATRIX_UNITS,
  MatrixArea,
  ROLE_MATRIX,
  ROLE_NOTES,
  RoleNoteKey,
  accessOf,
  allowedLevels,
  AreaKey,
  atLeast,
  columnOf,
  defaultRoleMatrix,
  effectiveFor,
  GUARDRAILS,
  levelBounds,
  levelFor,
  RolePermissionsResponse,
  RolePermissionsWrite,
  withinBounds,
} from "./role-matrix";
import { ROLE_SCOPE } from "./roles";

const ROLES = AppRole.options;
const AREAS = MatrixArea.options;

describe("the matrix's shape", () => {
  it("has a level for every role on every row", () => {
    for (const area of AREAS) {
      expect(Object.keys(ROLE_MATRIX[area]).sort()).toEqual([...ROLES].sort());
      for (const role of ROLES) expect(AccessLevel.safeParse(ROLE_MATRIX[area][role]).success).toBe(true);
    }
  });

  it("puts every row in exactly one group", () => {
    const grouped = MATRIX_GROUPS.flatMap((g) => g.areas);
    expect([...grouped].sort()).toEqual([...AREAS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("shows each of the eight roles once, as a column", () => {
    expect([...MATRIX_ROLES].sort()).toEqual([...ROLES].sort());
  });

  it("takes the «Μονάδες» row from the role catalogue, so finance reads all units", () => {
    expect(MATRIX_UNITS).toEqual(ROLE_SCOPE);
    expect(MATRIX_UNITS.finance).toBe("all");
    expect(MATRIX_UNITS.technician).toBe("unit");
  });

  it("orders the levels NONE < READ < WRITE < APPROVE < MANAGE", () => {
    expect(atLeast("MANAGE", "APPROVE")).toBe(true);
    expect(atLeast("APPROVE", "WRITE")).toBe(true);
    expect(atLeast("WRITE", "APPROVE")).toBe(false);
    expect(atLeast("READ", "READ")).toBe(true);
    expect(atLeast("NONE", "READ")).toBe(false);
  });
});

describe("the rules the matrix states", () => {
  it("RULE (ADR-0010): the auditor and the executive write nothing anywhere", () => {
    for (const area of AREAS) {
      expect(atLeast(accessOf(area, "auditor_readonly"), "WRITE")).toBe(false);
      expect(atLeast(accessOf(area, "executive_readonly"), "WRITE")).toBe(false);
    }
  });

  it("RULE (ADR-0014): only finance changes the approved budget, the administrator included", () => {
    const deciders = ROLES.filter((role) => atLeast(accessOf("approvedBudget", role), "WRITE"));
    expect(deciders).toEqual(["finance"]);
  });

  it("RULE (ADR-0015, R10): a variation is decided by the head of estates or the administrator", () => {
    const deciders = ROLES.filter((role) => atLeast(accessOf("variationDecide", role), "APPROVE"));
    expect(deciders.sort()).toEqual(["admin", "estates_head"]);
  });

  it("a technician reads Έργα and writes asset condition and readings", () => {
    expect(accessOf("projectRecords", "technician")).toBe("READ");
    expect(accessOf("assetCondition", "technician")).toBe("WRITE");
  });

  it("only the administrator manages users and eFinance", () => {
    for (const area of ["users", "efinance"] as const) {
      expect(ROLES.filter((role) => accessOf(area, role) === "MANAGE")).toEqual(["admin"]);
    }
  });

  it("the whole audit trail is read by the auditor and the administrator only", () => {
    expect(ROLES.filter((role) => accessOf("auditTrail", role) !== "NONE").sort()).toEqual(["admin", "auditor_readonly"]);
  });

  it("only the clinical approver decides a clinical approval line", () => {
    expect(ROLES.filter((role) => atLeast(accessOf("permitClinical", role), "APPROVE"))).toEqual(["clinical_approver"]);
  });
});

describe("the notes", () => {
  it("gives every role at least one note and uses only known keys", () => {
    for (const role of ROLES) {
      expect(ROLE_NOTES[role].length).toBeGreaterThan(0);
      for (const key of ROLE_NOTES[role]) expect(RoleNoteKey.safeParse(key).success).toBe(true);
    }
    for (const key of GENERAL_NOTES) expect(RoleNoteKey.safeParse(key).success).toBe(true);
  });

  it("uses every note key exactly once", () => {
    const used = [...GENERAL_NOTES, ...ROLES.flatMap((role) => ROLE_NOTES[role])];
    expect([...used].sort()).toEqual([...RoleNoteKey.options].sort());
  });
});

describe("ADR-0033: the editable matrix", () => {
  it("the defaults sit inside every guardrail, so the seed and a reset never trip the trigger", () => {
    for (const area of AREAS) {
      for (const role of ROLES) {
        expect({ area, role, ok: withinBounds(role, area, ROLE_MATRIX[area][role]) }).toEqual({ area, role, ok: true });
      }
    }
  });

  it("locks the administrator's MANAGE on users and nothing below READ elsewhere", () => {
    expect(allowedLevels("admin", "users")).toEqual(["MANAGE"]);
    expect(allowedLevels("admin", "defects")).toEqual(["READ", "WRITE", "APPROVE", "MANAGE"]);
    expect(levelBounds("admin", "users").guardrails).toContain("adminUsers");
  });

  it("keeps the two read-only roles at READ or below and the audit trail at READ or below", () => {
    expect(allowedLevels("auditor_readonly", "defects")).toEqual(["NONE", "READ"]);
    expect(allowedLevels("executive_readonly", "reports")).toEqual(["NONE", "READ"]);
    expect(allowedLevels("finance", "auditTrail")).toEqual(["NONE", "READ"]);
    expect(allowedLevels("admin", "auditTrail")).toEqual(["READ"]);
  });

  it("keeps the users row NONE for every role but the administrator", () => {
    for (const role of ROLES.filter((r) => r !== "admin")) expect(allowedLevels(role, "users")).toEqual(["NONE"]);
  });

  it("leaves an ordinary cell free", () => {
    expect(levelBounds("technician", "defects")).toEqual({ min: "NONE", max: "MANAGE", guardrails: [] });
  });

  it("takes the highest level any of the roles holds, and NONE for no role", () => {
    const matrix = defaultRoleMatrix();
    expect(levelFor(matrix, ["technician", "finance"], "budgetLines")).toBe("WRITE");
    expect(levelFor(matrix, [], "portfolio")).toBe("NONE");
    matrix.defects.technician = "NONE";
    expect(levelFor(matrix, ["technician"], "defects")).toBe("NONE");
    expect(ROLE_MATRIX.defects.technician).toBe("WRITE");
  });

  it("effectiveFor gives a level for every area", () => {
    const effective = effectiveFor(ROLE_MATRIX, ["clinical_approver"]);
    expect(Object.keys(effective).sort()).toEqual([...AREAS].sort());
    expect(effective.permitClinical).toBe("APPROVE");
    expect(effective.reports).toBe("NONE");
  });

  it("the write body is the whole column and nothing else", () => {
    const column = columnOf(ROLE_MATRIX, "technician");
    expect(RolePermissionsWrite.safeParse(column).success).toBe(true);
    const short: Partial<typeof column> = { ...column };
    delete short.defects;
    expect(RolePermissionsWrite.safeParse(short).success).toBe(false);
    expect(RolePermissionsWrite.safeParse({ ...column, defects: "ALL" }).success).toBe(false);
  });

  it("the response carries the matrix, the guardrail keys and the last change", () => {
    const parsed = RolePermissionsResponse.parse({ matrix: ROLE_MATRIX, guardrails: [...GUARDRAILS], updatedAt: null });
    expect(parsed.matrix.users.admin).toBe("MANAGE");
    expect(AreaKey.options).toEqual(MatrixArea.options);
  });
});
