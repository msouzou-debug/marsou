import { z } from "zod";

// ADR-0033. The two enums the role matrix is made of, in a file of their own
// so that `auth.ts` (whose `Me` carries the caller's levels) and
// `role-matrix.ts` (which needs `AppRole` from `auth.ts`) never import each
// other. `role-matrix.ts` re-exports all of it.

export const AccessLevel = z.enum(["NONE", "READ", "WRITE", "APPROVE", "MANAGE"]);
export type AccessLevel = z.infer<typeof AccessLevel>;

export const ACCESS_RANK: Record<AccessLevel, number> = {
  NONE: 0,
  READ: 1,
  WRITE: 2,
  APPROVE: 3,
  MANAGE: 4,
};

/** True when `level` is `min` or higher. */
export function atLeast(level: AccessLevel, min: AccessLevel): boolean {
  return ACCESS_RANK[level] >= ACCESS_RANK[min];
}


/** One row of the matrix. Labels are i18n keys under `screens.s24roles.areas`. */
export const MatrixArea = z.enum([
  "portfolio",
  // Έργα
  "projectRecords",
  "projectPhase",
  "approvedBudget",
  // Συμβάσεις
  "contractRecords",
  "rfisInstructions",
  "variationSubmit",
  "variationDecide",
  "defects",
  "paymentCertCreate",
  "paymentCertEngineer",
  "paymentCertFinance",
  // Κόστος
  "sapImport",
  "budgetLines",
  "accruals",
  "forecastWarnings",
  // Διακοπές και άδειες
  "permitRequest",
  "permitClinical",
  "permitOperate",
  "permitCalendar",
  // Πάγια
  "assetRegister",
  "assetCondition",
  "assetDocuments",
  "assetForecast",
  "assetLabels",
  // Συντήρηση
  "workOrderRaise",
  "workOrderWork",
  "maintenanceAgreement",
  "backlog",
  "backlogToProject",
  "scorecard",
  // Αναφορές
  "reports",
  // Διαχείριση
  "users",
  "contractors",
  "efinance",
  // Ίχνος ελέγχου
  "auditTrail",
]);
export type MatrixArea = z.infer<typeof MatrixArea>;
