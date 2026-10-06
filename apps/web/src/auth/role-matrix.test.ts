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
 * Έργα: the helpers were narrowed on 06/10/2026 to the row policy
 * (`ecapital.can_manage_project`, migration 0002), so the plain agreement
 * holds here too and there is no exceptions list any more.
 */
describe("Έργα: helpers and matrix agree", () => {
  it("canWriteProjects is exactly the roles the matrix lets write the register", () => {
    for (const role of ROLES) {
      expect(canWriteProjects([role])).toBe(atLeast(ROLE_MATRIX.projectRecords[role], "WRITE"));
    }
  });

  it("canChangeProjectPhase is exactly the roles the matrix lets move the phase", () => {
    for (const role of ROLES) {
      expect(canChangeProjectPhase([role])).toBe(atLeast(ROLE_MATRIX.projectPhase[role], "WRITE"));
    }
  });
});
