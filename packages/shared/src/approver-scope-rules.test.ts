import { describe, expect, it } from "vitest";
import {
  allowedApproverScopeRoles,
  approvalRoleHolders,
  approverScopesRefusal,
  mayHoldApproverScopes,
  type ApproverScopes,
} from "./permit";

// ADR-0039 (owner decision 26/11/2026): who may hold which approver scope.
const unit = (role: ApproverScopes["units"][number]["role"]): ApproverScopes => ({
  areas: [],
  units: [{ orgUnitId: "larnaca-general", role }],
});
const area: ApproverScopes = { areas: [{ areaId: "a", role: "WARD_MANAGER" }], units: [] };

describe("approver scope rules", () => {
  it("lets the technical and safety approver hold TECHNICAL and SAFETY and nothing else", () => {
    expect(allowedApproverScopeRoles(["technical_approver"])).toEqual({
      areas: [],
      units: ["TECHNICAL", "SAFETY"],
    });
    expect(approverScopesRefusal(["technical_approver"], unit("TECHNICAL"))).toBeNull();
    expect(approverScopesRefusal(["technical_approver"], unit("SAFETY"))).toBeNull();
    for (const role of ["HOSPITAL_DIRECTOR", "INFECTION_CONTROL", "NURSING"] as const) {
      expect(approverScopesRefusal(["technical_approver"], unit(role))).toBe("errors.approverScopesNeedRole");
    }
    expect(approverScopesRefusal(["technical_approver"], area)).toBe("errors.approverScopesNeedRole");
  });

  it("lets the estates head hold TECHNICAL and SAFETY, as the seed has always appointed", () => {
    expect(allowedApproverScopeRoles(["estates_head"]).units).toEqual(["TECHNICAL", "SAFETY"]);
    expect(approverScopesRefusal(["estates_head"], unit("SAFETY"))).toBeNull();
    expect(approverScopesRefusal(["estates_head"], unit("NURSING"))).toBe("errors.approverScopesNeedRole");
  });

  it("keeps every scope open to the clinical approver, so the live appointments keep working", () => {
    expect(allowedApproverScopeRoles(["clinical_approver"])).toEqual({
      areas: ["WARD_MANAGER", "NURSING", "INFECTION_CONTROL"],
      units: ["TECHNICAL", "SAFETY", "HOSPITAL_DIRECTOR", "INFECTION_CONTROL", "NURSING"],
    });
    expect(approverScopesRefusal(["clinical_approver"], unit("TECHNICAL"))).toBeNull();
    expect(approverScopesRefusal(["clinical_approver"], area)).toBeNull();
  });

  it("refuses a technical scope to a role that holds none of the three, with its own sentence", () => {
    expect(approverScopesRefusal(["technician"], unit("TECHNICAL"))).toBe("errors.approverScopesNeedTechnicalRole");
    expect(approverScopesRefusal(["project_engineer"], unit("SAFETY"))).toBe(
      "errors.approverScopesNeedTechnicalRole",
    );
    expect(approverScopesRefusal(["technician"], area)).toBe("errors.approverScopesNeedRole");
    expect(mayHoldApproverScopes(["technician"])).toBe(false);
    expect(mayHoldApproverScopes(["finance", "admin"])).toBe(false);
  });

  it("takes an empty replacement from anybody, because clearing is not granting", () => {
    expect(approverScopesRefusal([], { areas: [], units: [] })).toBeNull();
  });

  it("adds up the roles of an account that holds several", () => {
    expect(allowedApproverScopeRoles(["technical_approver", "clinical_approver"]).units).toHaveLength(5);
    expect(mayHoldApproverScopes(["technical_approver"])).toBe(true);
  });

  // Owner decision 26/11/2026: routing hands a line only to somebody whose
  // role may decide it, read from the same two lists as the scopes.
  it("names the account roles routing may hand each approval line to", () => {
    for (const role of ["TECHNICAL", "SAFETY"] as const) {
      expect(approvalRoleHolders(role)).toEqual(["technical_approver", "clinical_approver", "estates_head"]);
    }
    for (const role of ["WARD_MANAGER", "NURSING", "INFECTION_CONTROL", "HOSPITAL_DIRECTOR"] as const) {
      expect(approvalRoleHolders(role)).toEqual(["clinical_approver"]);
    }
  });
});
