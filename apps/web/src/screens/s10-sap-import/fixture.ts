// S10 — fixture shared by the test and preview files.
import type { ImportBatch, Suggestion, UnmatchedQueue as UnmatchedQueueData, UnmatchedRow } from "@ecapital/shared";

export function buildImportBatch(overrides: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: "batch-1",
    source: "SAP_EXTRACT",
    report: "ME2N",
    fileName: "me2n-2026-09.csv",
    fileSha256: "abc123",
    profileId: "me2n-v1",
    period: "2026-09",
    rowsIn: 312,
    rowsMatched: 265,
    rowsUnmatched: 47,
    rowsRejected: 0,
    amountIn: 1_240_000,
    amountMatched: 1_050_000,
    status: "PENDING_ALLOCATION",
    importedById: "user-finance",
    importedByName: "Ελένη Χριστοδούλου",
    importedAt: "2026-09-02T07:00:00.000Z",
    errorEl: null,
    errorEn: null,
    ...overrides,
  };
}

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    projectId: "p-031",
    projectCode: "PRJ-031",
    projectTitleEl: "Αντικατάσταση ακτινολογικού εξοπλισμού",
    contractId: "c-1",
    contractRef: "CAP-2026-0012",
    confidence: "HIGH",
    reason: "SAME_WBS",
    ...overrides,
  };
}

function unmatchedRow(index: number, overrides: Partial<UnmatchedRow> = {}): UnmatchedRow {
  return {
    txn: {
      id: `txn-${index}`,
      orgUnitId: "unit-1",
      projectId: null,
      contractId: null,
      workOrderId: null,
      assetId: null,
      budgetLineId: null,
      txnType: "ACTUAL",
      source: "SAP_EXTRACT",
      sourceRef: `DOC-${1000 + index}`,
      docDate: "2026-09-01",
      postingDate: "2026-09-02",
      amount: 1250.5 + index,
      currency: "EUR",
      description: `Τιμολόγιο προμηθευτή #${index}`,
      vendorName: "Αφοί Παπαδόπουλοι Α.Ε.",
      sapWbs: "WBS-031",
      sapPo: null,
      costCentre: "CC-100",
      glAccount: "600100",
      importBatchId: "batch-1",
      matchedBy: "NONE",
      vendorNo: null,
      contractRef: null,
      invoiceRef: null,
      efinanceInvoiceId: null,
    },
    suggestions: [suggestion()],
    ...overrides,
  };
}

/** ADR-0036: a CAPEX_LINES batch, as the connector or a file upload leaves it. */
export function buildCapexBatch(overrides: Partial<ImportBatch> = {}): ImportBatch {
  return buildImportBatch({
    id: "batch-capex-1",
    report: "CAPEX_LINES",
    fileName: "capex-lines-2026-10.csv",
    profileId: "capexlines-v1",
    period: "2026-10",
    rowsIn: 40,
    rowsMatched: 36,
    rowsUnmatched: 4,
    ...overrides,
  });
}

/** One line carrying the SAP vendor number and the CAP- reference, one matched by eFinance invoice, one with neither. */
export function buildCapexQueue(): UnmatchedQueueData {
  const base = buildUnmatchedQueue(3);
  const [a, b, c] = base.items;
  return {
    ...base,
    items: [
      { ...a, txn: { ...a.txn, vendorNo: "100234", contractRef: "CAP-2026-0012", matchedBy: "CONTRACT_REF" } },
      { ...b, txn: { ...b.txn, vendorNo: "100871", invoiceRef: "INV-5521", matchedBy: "EFINANCE_INVOICE", efinanceInvoiceId: "inv-1" } },
      c,
    ],
  };
}

export function buildUnmatchedQueue(count = 3): UnmatchedQueueData {
  return {
    batchId: "batch-1",
    remaining: count,
    total: 47,
    items: Array.from({ length: count }, (_, i) => unmatchedRow(i)),
  };
}
