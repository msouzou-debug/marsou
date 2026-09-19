// S07 — fixture shared by the preview and the test file. Obviously fake
// figures for a fake contract, per CAPEX-01 §15.
import type { ContractDetail } from "@ecapital/shared";

export function buildContractDetail(overrides: Partial<ContractDetail> = {}): ContractDetail {
  const originalValue = 2_400_000;
  return {
    id: "contract-1",
    projectId: "project-1",
    orgUnitId: "larnaca-general",
    contractorId: "contractor-1",
    contractorName: "Κυριάκου Τεχνικές Κατασκευές Λτδ",
    // ADR-0019: allocated by the API, never typed. The number next to it is
    // the one off the tender papers.
    ref: "CAP-2026-0031",
    contractNo: "ΤΥ/2026/031",
    type: "BOQ",
    awardDate: "2026-01-10",
    awardDecisionDocId: null,
    originalValue,
    currentValue: originalValue,
    currency: "EUR",
    startDate: "2026-01-24",
    completionDate: "2026-10-01",
    extensionDays: 0,
    retentionPct: 5,
    performanceBondValue: 240_000,
    bondExpiry: "2026-12-31",
    liquidatedDamagesPerDay: 1200,
    defectsLiabilityMonths: 12,
    sapPoNumber: "45100031",
    emapRef: null,
    // ADR-0025, owner decision 19/09/2026: one CAPEX budget code per contract.
    budgetCode: "7402",
    budgetCodeDescriptionEl: "Ιατρικός και λοιπός εξοπλισμός",
    budgetCodeDescriptionEn: "Medical and other equipment",
    createdAt: null,
    updatedAt: null,
    project: { id: "project-1", code: "LAR-2026-031", titleEl: "Αντικατάσταση ακτινολογικού εξοπλισμού" },
    contractor: {
      id: "contractor-1",
      name: "Κυριάκου Τεχνικές Κατασκευές Λτδ",
      vatNumber: "CY10231455X",
      registrationNo: "HE 118422",
      category: "BUILDING",
      sapVendorId: "V-100101",
      blacklisted: false,
    },
    boq: [
      { id: "boq-1", contractId: "contract-1", itemNo: "A.01", descriptionEl: "Καθαιρέσεις και αποκομιδή υλικών", unit: "m3", qty: 240, rate: 38.5, amount: 9240 },
      { id: "boq-2", contractId: "contract-1", itemNo: "A.02", descriptionEl: "Οπλισμένο σκυρόδεμα C25/30", unit: "m3", qty: 185, rate: 145, amount: 26825 },
    ],
    variations: [
      {
        id: "variation-1",
        contractId: "contract-1",
        number: 1,
        descriptionEl: "Αντικατάσταση δικτύου αποχέτευσης",
        reason: "SITE_CONDITION",
        value: 144_000,
        timeImpactDays: 21,
        status: "APPROVED",
        raisedById: "user-engineer",
        raisedByName: "Γιώργος Ιωάννου",
        raisedAt: "2026-03-01T09:00:00.000Z",
        decidedById: "user-admin",
        decidedByName: "Μαρία Κωνσταντίνου",
        decidedAt: "2026-03-05T09:00:00.000Z",
        decisionCommentEl: null,
      },
    ],
    approvedVariationsTotal: 336_000,
    pendingVariationsTotal: 48_000,
    variationPctOfOriginal: 14,
    warnings: [
      {
        key: "variationsOverTenPct",
        sentenceEl: "Οι εγκεκριμένες τροποποιήσεις της σύμβασης ΤΥ/2026/031 έφτασαν το 14,0 % της αρχικής αξίας.",
        sentenceEn: "Approved variations on contract ΤΥ/2026/031 have reached 14.0% of the original value.",
        amount: 336_000,
      },
    ],
    ...overrides,
  };
}
