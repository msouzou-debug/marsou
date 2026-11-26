import {
  type AccessLevel,
  ApprovalRole,
  type AppRole,
  type MatrixArea,
  type RoleMatrix,
  atLeast,
  defaultRoleMatrix,
  levelFor,
} from "@ecapital/shared";
import { describe, expect, it } from "vitest";
import { LINE_NEEDS, mayDecideLine } from "./line-needs";

/**
 * Which roles the default matrix lets decide which line (ADR-0033, ADR-0039).
 * The assignment check is the service's and is not what is tested here.
 */
const holds =
  (roles: AppRole[], matrix: RoleMatrix = defaultRoleMatrix()) =>
  (area: MatrixArea, level: AccessLevel) =>
    atLeast(levelFor(matrix, roles, area), level);

const CLINICAL_LINES = ["INFECTION_CONTROL", "WARD_MANAGER", "NURSING", "HOSPITAL_DIRECTOR"] as const;
const TECHNICAL_LINES = ["TECHNICAL", "SAFETY"] as const;

describe("LINE_NEEDS", () => {
  it("names every approval role", () => {
    expect(Object.keys(LINE_NEEDS).sort()).toEqual([...ApprovalRole.options].sort());
  });

  it("lets the technical and safety approver decide TECHNICAL and SAFETY", () => {
    for (const line of TECHNICAL_LINES) expect(mayDecideLine(line, holds(["technical_approver"]))).toBe(true);
  });

  it("does not let the technical and safety approver decide a clinical line", () => {
    for (const line of CLINICAL_LINES) expect(mayDecideLine(line, holds(["technical_approver"]))).toBe(false);
  });

  it("keeps the clinical approver on TECHNICAL and SAFETY, for the appointments made before ADR-0039", () => {
    for (const line of [...CLINICAL_LINES, ...TECHNICAL_LINES]) {
      expect(mayDecideLine(line, holds(["clinical_approver"]))).toBe(true);
    }
  });

  it("gives the estates head and the administrator the technical lines through the technical row", () => {
    for (const role of ["estates_head", "admin"] as const) {
      for (const line of TECHNICAL_LINES) expect(mayDecideLine(line, holds([role]))).toBe(true);
      for (const line of CLINICAL_LINES) expect(mayDecideLine(line, holds([role]))).toBe(false);
    }
  });

  it("no longer reads the request row: taking the technical row away takes the lines away", () => {
    const changed = defaultRoleMatrix();
    changed.permitTechnical.estates_head = "READ";
    const estates = holds(["estates_head"], changed);
    expect(changed.permitRequest.estates_head).toBe("APPROVE");
    for (const line of TECHNICAL_LINES) expect(mayDecideLine(line, estates)).toBe(false);
    for (const line of TECHNICAL_LINES) {
      expect(LINE_NEEDS[line].map(([area]) => area)).toEqual(["permitTechnical", "permitClinical"]);
    }
  });

  it("refuses every line to the roles that decide none", () => {
    for (const role of ["project_engineer", "technician", "finance", "executive_readonly", "auditor_readonly"] as const) {
      for (const line of ApprovalRole.options) expect(mayDecideLine(line, holds([role]))).toBe(false);
    }
  });
});
