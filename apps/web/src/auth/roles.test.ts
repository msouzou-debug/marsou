import { describe, expect, it } from "vitest";
import type { AppRole } from "@ecapital/shared";
import {
  canApprovePaymentCertEngineer,
  canCreatePaymentCert,
  canDismissCostWarning,
  canImportSap,
  canManageBudgetLines,
  canProcessPaymentCertFinance,
  canSetForecastInputs,
  canViewAccruals,
  canViewCostNav,
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

describe("M2 role checks", () => {
  it("lets only project_engineer/estates_head/admin set forecast inputs and dismiss a warning", () => {
    const allowed = ALL_ROLES.filter((role) => canSetForecastInputs([role]));
    expect(allowed.sort()).toEqual(["admin", "estates_head", "project_engineer"]);
    expect(ALL_ROLES.filter((role) => canDismissCostWarning([role])).sort()).toEqual(allowed.sort());
  });

  it("lets only finance/admin manage budget lines and run a SAP import", () => {
    const allowed = ALL_ROLES.filter((role) => canManageBudgetLines([role]));
    expect(allowed.sort()).toEqual(["admin", "finance"]);
    expect(ALL_ROLES.filter((role) => canImportSap([role])).sort()).toEqual(allowed.sort());
  });

  it("lets the contract team create a payment certificate", () => {
    expect(canCreatePaymentCert(["project_engineer"])).toBe(true);
    expect(canCreatePaymentCert(["finance"])).toBe(false);
    expect(canCreatePaymentCert(["technician"])).toBe(false);
  });

  it("gates engineer approval and finance processing separately", () => {
    expect(canApprovePaymentCertEngineer(["project_engineer"])).toBe(true);
    expect(canApprovePaymentCertEngineer(["finance"])).toBe(false);
    expect(canProcessPaymentCertFinance(["finance"])).toBe(true);
    expect(canProcessPaymentCertFinance(["project_engineer"])).toBe(false);
  });

  // Explicit in the build brief.
  it("shows accruals to finance/admin/estates_head/executive_readonly/auditor_readonly only", () => {
    const allowed = ALL_ROLES.filter((role) => canViewAccruals([role])).sort();
    expect(allowed).toEqual(["admin", "auditor_readonly", "estates_head", "executive_readonly", "finance"].sort());
    expect(canViewAccruals(["project_engineer"])).toBe(false);
    expect(canViewAccruals(["technician"])).toBe(false);
    expect(canViewAccruals(["clinical_approver"])).toBe(false);
  });

  it("shows the «Κόστος» nav entry to anyone who reaches SAP import or accruals, nobody else", () => {
    expect(canViewCostNav(["finance"])).toBe(true);
    expect(canViewCostNav(["estates_head"])).toBe(true); // via accruals only
    expect(canViewCostNav(["project_engineer"])).toBe(false);
    expect(canViewCostNav([])).toBe(false);
  });
});
