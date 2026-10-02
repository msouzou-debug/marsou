// eFinance (ADR-0029) — fixtures shared by the unit tests and the /preview
// gallery. There is no request-mocking layer in this app (the data hooks go
// through the same-origin proxy to the real API, see `src/data/client.ts`), so
// "a mock for every new endpoint" is a builder per response shape here: each
// returns exactly what the API's controller answers, so a test or a preview
// renders the screen on the real DTO and not on a hand-shaped object.
//
// Obviously fake figures, round numbers, never real vendors or invoices
// (CAPEX-01 §15).
import type {
  BudgetPosition,
  ContractBudgetPosition,
  EFinanceContractStatus,
  EFinanceContractSummary,
  EFinanceInvoice,
  EFinanceInvoiceList,
  EFinanceMasterSyncResult,
  EFinanceRequisition,
  EFinanceRequisitionList,
  EFinanceSyncResult,
  EFinanceVendor,
  EFinanceVendorList,
  ProjectBudgetPosition,
} from "@ecapital/shared";

/** GET /contracts/:id → `efinance`, with figures. Pass `null`s for "eFinance has no figure". */
export function buildEFinanceSummary(overrides: Partial<EFinanceContractSummary> = {}): EFinanceContractSummary {
  return {
    pushedAt: "2026-09-30T08:15:00.000Z",
    lastError: null,
    booked: 480_000,
    inFlight: 96_000,
    requisitions: 240_000,
    remaining: 1_680_000,
    lastSyncAt: "2026-10-01T06:00:00.000Z",
    ...overrides,
  };
}

/** GET /contracts/:id/efinance and POST /contracts/:id/efinance/push. */
export function buildEFinanceStatus(overrides: Partial<EFinanceContractStatus> = {}): EFinanceContractStatus {
  return { ...buildEFinanceSummary(), configured: true, capRef: "CAP-2026-0031", ...overrides };
}

export function buildEFinanceInvoice(overrides: Partial<EFinanceInvoice> = {}): EFinanceInvoice {
  return {
    id: "inv-1",
    invoiceNo: "ΤΠ-2026-0412",
    invoiceDate: "2026-08-14",
    sapBatchDate: "2026-08-20",
    vendorCode: "V-100101",
    vendorName: "Κυριάκου Τεχνικές Κατασκευές Λτδ",
    entityCode: "LAR",
    currency: "EUR",
    net: 100_000,
    vat: 19_000,
    gross: 119_000,
    status: "posted",
    ledger: "booked",
    capRef: "CAP-2026-0031",
    reversedAt: null,
    reversalSapDocNo: null,
    reversalReason: null,
    updatedAt: "2026-08-20T07:00:00.000Z",
    lines: [
      {
        index: 0,
        descr: "Προμήθεια και εγκατάσταση ακτινολογικού συστήματος",
        qty: 1,
        unitPrice: 80_000,
        lineTotal: 80_000,
        vatRate: 19,
        glAccount: "2110",
        costCentre: "LAR-RAD",
        budgetCode: "7402",
        wbsCode: "WBS-031-01",
      },
      {
        index: 1,
        descr: "Εργασίες προσαρμογής χώρου",
        qty: 4,
        unitPrice: 5_000,
        lineTotal: 20_000,
        vatRate: 19,
        glAccount: "2110",
        costCentre: "LAR-RAD",
        budgetCode: "7402",
        wbsCode: null,
      },
    ],
    ...overrides,
  };
}

/** One invoice per ledger, so a list shows every chip. */
export function buildEFinanceInvoiceList(overrides: Partial<EFinanceInvoiceList> = {}): EFinanceInvoiceList {
  const items: EFinanceInvoice[] = [
    buildEFinanceInvoice(),
    buildEFinanceInvoice({
      id: "inv-2",
      invoiceNo: "ΤΠ-2026-0455",
      invoiceDate: "2026-09-12",
      sapBatchDate: null,
      net: 40_000,
      vat: 7_600,
      gross: 47_600,
      ledger: "in_flight",
      lines: [],
    }),
    buildEFinanceInvoice({
      id: "inv-3",
      invoiceNo: "ΤΠ-2026-0390",
      invoiceDate: "2026-07-30",
      sapBatchDate: "2026-08-02",
      net: 25_000,
      vat: 4_750,
      gross: 29_750,
      ledger: "reversed",
      reversedAt: "2026-08-10T09:30:00.000Z",
      reversalSapDocNo: "9000012345",
      reversalReason: "Διπλή καταχώριση του ίδιου τιμολογίου",
      lines: [],
    }),
    buildEFinanceInvoice({
      id: "inv-4",
      invoiceNo: "ΤΠ-2026-0460",
      invoiceDate: "2026-09-20",
      sapBatchDate: null,
      net: null,
      vat: null,
      gross: null,
      ledger: "rejected",
      lines: [],
    }),
  ];
  return { configured: true, items, total: items.length, ...overrides };
}

export function buildEFinanceRequisition(overrides: Partial<EFinanceRequisition> = {}): EFinanceRequisition {
  return {
    id: "req-1",
    number: "ΑΠ-2026-0088",
    description: "Ανταλλακτικά και αναλώσιμα ακτινολογικού συστήματος",
    justification: null,
    entityCode: "LAR",
    costCentre: "LAR-RAD",
    budgetCode: "7402",
    glAccount: "2110",
    amount: 60_000,
    currency: "EUR",
    status: "approved",
    capRef: "CAP-2026-0031",
    poNumber: "4500012345",
    createdAt: "2026-09-02T10:00:00.000Z",
    updatedAt: "2026-09-05T10:00:00.000Z",
    ...overrides,
  };
}

export function buildEFinanceRequisitionList(overrides: Partial<EFinanceRequisitionList> = {}): EFinanceRequisitionList {
  const items = [
    buildEFinanceRequisition(),
    buildEFinanceRequisition({
      id: "req-2",
      number: "ΑΠ-2026-0097",
      description: null,
      amount: null,
      status: "draft",
      poNumber: null,
      createdAt: "2026-09-25T10:00:00.000Z",
    }),
  ];
  return { configured: true, items, total: items.length, ...overrides };
}

export function buildBudgetPosition(overrides: Partial<BudgetPosition> = {}): BudgetPosition {
  return {
    budgetCode: "7402",
    entityCode: "LAR",
    year: 2026,
    allocated: 3_000_000,
    booked: 480_000,
    requisitions: 240_000,
    inFlight: 96_000,
    available: 2_280_000,
    asOf: "2026-10-02T06:30:00.000Z",
    ...overrides,
  };
}

/** GET /contracts/:id/budget-position. */
export function buildContractBudgetPosition(overrides: Partial<ContractBudgetPosition> = {}): ContractBudgetPosition {
  return { configured: true, position: buildBudgetPosition(), ...overrides };
}

/** GET /projects/:id/budget-position. */
export function buildProjectBudgetPosition(overrides: Partial<ProjectBudgetPosition> = {}): ProjectBudgetPosition {
  return {
    configured: true,
    items: [
      buildBudgetPosition(),
      buildBudgetPosition({
        budgetCode: "7410",
        year: 2027,
        allocated: 500_000,
        booked: null,
        requisitions: null,
        inFlight: null,
        available: null,
        asOf: "2026-10-02T06:30:00.000Z",
      }),
    ],
    ...overrides,
  };
}

export function buildEFinanceVendor(overrides: Partial<EFinanceVendor> = {}): EFinanceVendor {
  return { vendorCode: "V-100101", name: "Κυριάκου Τεχνικές Κατασκευές Λτδ", vat: "CY10231455X", blocked: false, active: true, ...overrides };
}

/** GET /efinance/vendors?q= */
export function buildEFinanceVendorList(items?: EFinanceVendor[]): EFinanceVendorList {
  return {
    items: items ?? [
      buildEFinanceVendor(),
      buildEFinanceVendor({ vendorCode: "V-100112", name: "Λευκαρίτης Γενικές Εργολαβίες Λτδ", vat: "CY10348275W", blocked: true }),
      buildEFinanceVendor({ vendorCode: "V-100140", name: "Μεσογειακά Ηλεκτρομηχανολογικά Λτδ", vat: null, active: false }),
    ],
  };
}

/** POST /admin/efinance/sync */
export function buildEFinanceSyncResult(overrides: Partial<EFinanceSyncResult> = {}): EFinanceSyncResult {
  return {
    configured: true,
    invoices: { rows: 12, cursor: "2026-10-02T06:45:00.000Z", error: null },
    requisitions: { rows: 3, cursor: "2026-10-02T06:45:00.000Z", error: null },
    contractsRefreshed: 7,
    ranAt: "2026-10-02T06:45:00.000Z",
    ...overrides,
  };
}

/** POST /admin/efinance/sync-master */
export function buildEFinanceMasterSyncResult(overrides: Partial<EFinanceMasterSyncResult> = {}): EFinanceMasterSyncResult {
  return {
    configured: true,
    unitsMatched: 11,
    vendorsUpserted: 240,
    vendorsDeactivated: 2,
    error: null,
    ranAt: "2026-10-02T06:50:00.000Z",
    ...overrides,
  };
}
