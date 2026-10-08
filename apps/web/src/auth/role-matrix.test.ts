// S24r — the web helpers follow whatever role matrix is loaded (ADR-0033).
//
// Until 08/10/2026 this file checked the static `ROLE_MATRIX` against
// helpers that carried their own role lists. Now the helpers read the matrix
// the session loaded (`./role-matrix-store`), so the check is the other way
// round: load a matrix — the defaults, then one the administrator could have
// made — and every helper must answer what that matrix says, role by role.
import { afterEach, describe, expect, it } from "vitest";
import {
  AppRole,
  MatrixArea,
  ROLE_MATRIX,
  AccessLevel,
  atLeast,
  defaultRoleMatrix,
  type MatrixArea as Area,
  type RoleMatrix,
} from "@ecapital/shared";
import {
  canApprovePaymentCertEngineer,
  canChangeProjectPhase,
  canCreatePaymentCert,
  canDecideVariations,
  canDismissCostWarning,
  canFundBacklog,
  canImportSap,
  canManageApproverScopes,
  canManageBacklog,
  canManageBudgetLines,
  canManageContractors,
  canManageDefect,
  canManageMaintenanceContract,
  canOperatePermit,
  canProcessPaymentCertFinance,
  canRaiseVariations,
  canRaiseWorkOrder,
  canRecordAssetCondition,
  canRejectPermit,
  canSetForecastInputs,
  canUploadAssetDocuments,
  canViewAccruals,
  canViewCostNav,
  canViewReplacementForecast,
  canViewReports,
  canViewRoleMatrix,
  canViewScorecard,
  canWorkWorkOrder,
  canWriteAssets,
  canWriteContracts,
  canWritePermits,
  canWriteProjects,
  canWriteRfis,
  canWriteSiteInstructions,
  getRoleMatrix,
  isAdmin,
  setRoleMatrix,
} from "./roles";

const ROLES = AppRole.options;
const READ_ONLY: AppRole[] = ["auditor_readonly", "executive_readonly"];

type Helper = (roles: AppRole[]) => boolean;

/** helper ⇔ the row is at `min` or above, for each role on its own. */
const AGREEMENTS: Array<[name: string, helper: Helper, area: Area, min: AccessLevel]> = [
  ["canWriteProjects", canWriteProjects, "projectRecords", "WRITE"],
  ["canChangeProjectPhase", canChangeProjectPhase, "projectPhase", "WRITE"],
  ["canManageContractors", canManageContractors, "contractors", "MANAGE"],
  ["canWriteContracts", canWriteContracts, "contractRecords", "WRITE"],
  ["canWriteRfis", canWriteRfis, "rfisInstructions", "WRITE"],
  ["canWriteSiteInstructions", canWriteSiteInstructions, "rfisInstructions", "WRITE"],
  ["canRaiseVariations", canRaiseVariations, "variationSubmit", "WRITE"],
  ["canDecideVariations", canDecideVariations, "variationDecide", "APPROVE"],
  ["canManageDefect(INSPECTION)", (r) => canManageDefect(r, "INSPECTION"), "defects", "WRITE"],
  ["canCreatePaymentCert", canCreatePaymentCert, "paymentCertCreate", "WRITE"],
  ["canApprovePaymentCertEngineer", canApprovePaymentCertEngineer, "paymentCertEngineer", "APPROVE"],
  ["canProcessPaymentCertFinance", canProcessPaymentCertFinance, "paymentCertFinance", "APPROVE"],
  ["canImportSap", canImportSap, "sapImport", "WRITE"],
  ["canManageBudgetLines", canManageBudgetLines, "budgetLines", "WRITE"],
  ["canViewAccruals", canViewAccruals, "accruals", "READ"],
  ["canSetForecastInputs", canSetForecastInputs, "forecastWarnings", "WRITE"],
  ["canDismissCostWarning", canDismissCostWarning, "forecastWarnings", "WRITE"],
  ["canWritePermits", canWritePermits, "permitRequest", "WRITE"],
  ["canRejectPermit", canRejectPermit, "permitRequest", "APPROVE"],
  ["canOperatePermit", canOperatePermit, "permitOperate", "WRITE"],
  ["canWriteAssets", canWriteAssets, "assetRegister", "WRITE"],
  ["canRecordAssetCondition", canRecordAssetCondition, "assetCondition", "WRITE"],
  ["canUploadAssetDocuments", canUploadAssetDocuments, "assetDocuments", "WRITE"],
  ["canViewReplacementForecast", canViewReplacementForecast, "assetForecast", "READ"],
  ["canRaiseWorkOrder", canRaiseWorkOrder, "workOrderRaise", "WRITE"],
  ["canWorkWorkOrder", canWorkWorkOrder, "workOrderWork", "WRITE"],
  ["canManageMaintenanceContract", canManageMaintenanceContract, "maintenanceAgreement", "MANAGE"],
  ["canManageBacklog", canManageBacklog, "backlog", "WRITE"],
  ["canFundBacklog", canFundBacklog, "backlogToProject", "APPROVE"],
  ["canViewScorecard", canViewScorecard, "scorecard", "READ"],
  ["canViewReports", canViewReports, "reports", "READ"],
];

/** What the matrix says, with `can_write_unit`'s floor: a read-only role writes nothing. */
function expected(matrix: RoleMatrix, role: AppRole, area: Area, min: AccessLevel): boolean {
  if (atLeast(min, "WRITE") && READ_ONLY.includes(role)) return false;
  return atLeast(matrix[area][role], min);
}

/**
 * A matrix nobody would ship, on purpose: every cell moved, each role and
 * row by a different amount, so a helper still holding a role list of its
 * own cannot agree with it by accident.
 */
function scrambled(): RoleMatrix {
  const levels = AccessLevel.options;
  const matrix = defaultRoleMatrix();
  MatrixArea.options.forEach((area, a) => {
    ROLES.forEach((role, r) => {
      const now = levels.indexOf(matrix[area][role]);
      matrix[area][role] = levels[(now + a + r + 1) % levels.length];
    });
  });
  return matrix;
}

function checkAgainst(matrix: RoleMatrix) {
  for (const [name, helper, area, min] of AGREEMENTS) {
    for (const role of ROLES) {
      expect({ name, role, allowed: helper([role]) }).toEqual({ name, role, allowed: expected(matrix, role, area, min) });
    }
  }
  for (const role of ROLES) {
    // ADR-0017: a handover defect needs the contract row as well.
    const handover = expected(matrix, role, "defects", "WRITE") && expected(matrix, role, "contractRecords", "WRITE");
    expect({ role, handover: canManageDefect([role], "HANDOVER") }).toEqual({ role, handover });
    // The «Κόστος» nav: either of the two screens under it is not NONE.
    const shown = matrix.sapImport[role] !== "NONE" || matrix.accruals[role] !== "NONE";
    expect({ role, shown: canViewCostNav([role]) }).toEqual({ role, shown });
  }
}

afterEach(() => setRoleMatrix(null));

describe("the helpers read the loaded matrix", () => {
  it("starts on the shipped defaults until a session loads one", () => {
    expect(getRoleMatrix()).toBe(ROLE_MATRIX);
  });

  it("agrees with the defaults, role by role", () => {
    checkAgainst(ROLE_MATRIX);
  });

  it("follows a matrix the administrator changed, role by role", () => {
    const matrix = scrambled();
    setRoleMatrix(matrix);
    checkAgainst(matrix);
  });

  it("gives a technician «Προσθήκη» on the backlog the moment the matrix says WRITE, and takes it back on reset", () => {
    expect(canManageBacklog(["technician"])).toBe(false);
    const matrix = defaultRoleMatrix();
    matrix.backlog.technician = "WRITE";
    setRoleMatrix(matrix);
    expect(canManageBacklog(["technician"])).toBe(true);
    setRoleMatrix(null);
    expect(canManageBacklog(["technician"])).toBe(false);
  });

  it("takes the highest of several roles", () => {
    expect(canImportSap(["technician", "finance"])).toBe(true);
    const matrix = defaultRoleMatrix();
    matrix.sapImport.finance = "READ";
    setRoleMatrix(matrix);
    expect(canImportSap(["technician", "finance"])).toBe(false);
    expect(canImportSap(["finance", "admin"])).toBe(true);
  });

  it("RULE (ADR-0010): an account that also holds a read-only role writes nothing, whatever the matrix says", () => {
    const matrix = defaultRoleMatrix();
    setRoleMatrix(matrix);
    expect(canWriteProjects(["admin"])).toBe(true);
    expect(canWriteProjects(["admin", "auditor_readonly"])).toBe(false);
    expect(canViewReports(["finance", "executive_readonly"])).toBe(true);
  });
});

describe("what stays identity, not a row", () => {
  it("isAdmin and the approver-scope editor answer to the admin role alone, whatever the matrix", () => {
    setRoleMatrix(scrambled());
    expect(ROLES.filter((role) => isAdmin([role]))).toEqual(["admin"]);
    expect(ROLES.filter((role) => canManageApproverScopes([role]))).toEqual(["admin"]);
  });

  it("the «Ρόλοι και δικαιώματα» page is for the administrator and the head of estates", () => {
    setRoleMatrix(scrambled());
    expect(ROLES.filter((role) => canViewRoleMatrix([role])).sort()).toEqual(["admin", "estates_head"]);
  });
});
