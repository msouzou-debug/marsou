// S09 — fixture shared by the test and preview files.
import type { PaymentCert } from "@ecapital/shared";

export function buildPaymentCert(overrides: Partial<PaymentCert> = {}): PaymentCert {
  return {
    id: "cert-1",
    contractId: "contract-1",
    orgUnitId: "unit-1",
    number: 3,
    periodFrom: "2026-06-01",
    periodTo: "2026-06-30",
    workDoneValue: 480_000,
    materialsOnSite: 12_000,
    retentionHeld: 24_600,
    previousCertified: 400_000,
    netPayable: 67_400,
    status: "DRAFT",
    createdById: "user-engineer",
    createdByName: "Γιώργος Ιωάννου",
    approvedById: null,
    approvedByName: null,
    approvedAt: null,
    sapInvoiceRef: null,
    paidDate: null,
    retentionReleased: false,
    ...overrides,
  };
}
