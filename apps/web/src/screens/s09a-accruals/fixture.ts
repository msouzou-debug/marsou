// S09a — fixture shared by the test and preview files.
import type { AccrualRow } from "@ecapital/shared";

export function buildAccrualRow(overrides: Partial<AccrualRow> = {}): AccrualRow {
  return {
    projectId: "p-031",
    projectCode: "PRJ-031",
    projectTitleEl: "Αντικατάσταση ακτινολογικού εξοπλισμού",
    contractId: "c-1",
    contractRef: "CAP-2026-0012",
    contractorName: "Αφοί Παπαδόπουλοι Α.Ε.",
    costCentre: "CC-100",
    certNumber: 3,
    certifiedNet: 480_000,
    // ADR-0038: the accrual is the gross against what was invoiced (gross).
    vatRate: "STANDARD_19",
    certifiedVat: 91_200,
    certifiedGross: 571_200,
    invoiced: 420_000,
    accrual: 151_200,
    overInvoiced: false,
    asOf: "2026-12-31",
    ...overrides,
  };
}
