// S24r — the role matrix agrees with the helpers that decide each screen.
//
// `ROLE_MATRIX` in `@ecapital/shared` is what the «Ρόλοι και δικαιώματα»
// page shows people. The helpers in `./roles` are what the screens actually
// do. This file checks one against the other for every role, one row at a
// time, so the page cannot say something the screens do not do. When a row
// and its helper disagree, the helper is the rule and the matrix changes.
import { describe, expect, it } from "vitest";
import { AppRole, ROLE_MATRIX, atLeast, type AccessLevel, type MatrixArea } from "@ecapital/shared";
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
  isAdmin,
} from "./roles";

const ROLES = AppRole.options;

type Helper = (roles: AppRole[]) => boolean;

/** helper ⇔ the row is at `min` or above, for each role on its own. */
const AGREEMENTS: Array<[name: string, helper: Helper, area: MatrixArea, min: AccessLevel]> = [
  ["isAdmin", isAdmin, "users", "MANAGE"],
  ["canManageApproverScopes", canManageApproverScopes, "users", "MANAGE"],
  ["canManageContractors", canManageContractors, "contractors", "MANAGE"],
  ["canWriteContracts", canWriteContracts, "contractRecords", "WRITE"],
  ["canWriteRfis", canWriteRfis, "rfisInstructions", "WRITE"],
  ["canWriteSiteInstructions", canWriteSiteInstructions, "rfisInstructions", "WRITE"],
  ["canRaiseVariations", canRaiseVariations, "variationSubmit", "WRITE"],
  ["canDecideVariations", canDecideVariations, "variationDecide", "APPROVE"],
  ["canManageDefect(INSPECTION)", (r) => canManageDefect(r, "INSPECTION"), "defects", "WRITE"],
  ["canManageDefect(HANDOVER)", (r) => canManageDefect(r, "HANDOVER"), "contractRecords", "WRITE"],
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

describe("ROLE_MATRIX agrees with the web helpers, role by role", () => {
  for (const [name, helper, area, min] of AGREEMENTS) {
    it(`${name} ⇔ ${area} ≥ ${min}`, () => {
      for (const role of ROLES) {
        expect({ role, allowed: helper([role]) }).toEqual({ role, allowed: atLeast(ROLE_MATRIX[area][role], min) });
      }
    });
  }

  it("canViewCostNav ⇔ the SAP import or the accruals row is not NONE (the two screens under «Κόστος»)", () => {
    for (const role of ROLES) {
      const shown = ROLE_MATRIX.sapImport[role] !== "NONE" || ROLE_MATRIX.accruals[role] !== "NONE";
      expect({ role, shown: canViewCostNav([role]) }).toEqual({ role, shown });
    }
  });

  it("the «Ρόλοι και δικαιώματα» page is for the administrator and the head of estates", () => {
    expect(ROLES.filter((role) => canViewRoleMatrix([role])).sort()).toEqual(["admin", "estates_head"]);
  });
});

/**
 * KNOWN GAP, flagged rather than fixed here: `canWriteProjects` and
 * `canChangeProjectPhase` are wider than the API. The register's row policy
 * (`ecapital.can_manage_project`, migration 0002) gives the project to
 * admin, the head of estates and the engineers only, so a technician, a
 * finance officer or a clinical approver who presses «Προσθήκη» on S02 is
 * refused by the database. The matrix states what the database allows
 * (READ for those three). These tests pin the gap: if the helpers are
 * narrowed, the exceptions list here goes and the plain agreement above
 * takes over.
 */
describe("Έργα: the matrix follows the row policy where the helper is wider", () => {
  it("every role the matrix lets write the register is allowed by canWriteProjects", () => {
    for (const role of ROLES) {
      if (atLeast(ROLE_MATRIX.projectRecords[role], "WRITE")) expect(canWriteProjects([role])).toBe(true);
    }
  });

  it("the roles canWriteProjects allows beyond the row policy are exactly technician, finance and clinical approver", () => {
    const wider = ROLES.filter((role) => canWriteProjects([role]) && !atLeast(ROLE_MATRIX.projectRecords[role], "WRITE"));
    expect(wider.sort()).toEqual(["clinical_approver", "finance", "technician"]);
  });

  it("the roles canChangeProjectPhase allows beyond the row policy are exactly the technician", () => {
    for (const role of ROLES) {
      if (atLeast(ROLE_MATRIX.projectPhase[role], "WRITE")) expect(canChangeProjectPhase([role])).toBe(true);
    }
    const wider = ROLES.filter((role) => canChangeProjectPhase([role]) && !atLeast(ROLE_MATRIX.projectPhase[role], "WRITE"));
    expect(wider).toEqual(["technician"]);
  });
});
