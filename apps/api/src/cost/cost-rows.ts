/**
 * Turning cost rows into the shapes `packages/shared/src/cost.ts` publishes,
 * and the arithmetic that is a pure function of them.
 *
 * Kept out of the services so the ledger rules can be unit-tested without a
 * database — the four ledgers of CAPEX-01 §7 are the part of this milestone
 * that is easiest to get subtly wrong and hardest to see wrong afterwards.
 *
 * RULE (CAPEX-01 §12): money is a number of euro, credits negative, never
 * rounded in the database. `numeric` arrives from pg as a string so nothing
 * is lost in transit; it becomes a number here and at no earlier point.
 */
import type {
  CostCategoryRow,
  CostTxn,
  ForecastInputs,
  ImportBatch,
  PaymentCert,
} from "@ecapital/shared";

export function money(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

export function moneyOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : Number(value);
}

/** Two decimal places, the way a ledger is read, applied on the way out only. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The cost categories S04 groups the four ledgers by. The value is the i18n
 * key suffix, so the interface and the Excel export resolve the same label
 * from the same key. `uncategorised` is «Χωρίς κατηγορία»: it is not a
 * category anybody chose, it is where the money with no category lands, and
 * it exists so a total still ties.
 */
export const COST_CATEGORIES = ["works", "equipment", "fees", "contingency", "other"] as const;
export const UNCATEGORISED = "uncategorised";

export function categoryOf(value: string | null | undefined): string {
  if (!value) return UNCATEGORISED;
  return (COST_CATEGORIES as readonly string[]).includes(value) ? value : UNCATEGORISED;
}

export interface CostTxnRow {
  id: string;
  orgUnitId: string | null;
  projectId: string | null;
  contractId: string | null;
  budgetLineId: string | null;
  txnType: CostTxn["txnType"];
  source: CostTxn["source"];
  sourceRef: string | null;
  docDate: string | null;
  postingDate: string | null;
  amount: string | number;
  description: string | null;
  vendorName: string | null;
  sapWbs: string | null;
  sapPo: string | null;
  costCentre: string | null;
  glAccount: string | null;
  importBatchId: string | null;
  matchedBy: CostTxn["matchedBy"];
}

export function toCostTxn(row: CostTxnRow): CostTxn {
  return {
    id: row.id,
    // Empty while the row is in the unmatched queue: it belongs to no unit
    // until somebody allocates it (R14, migration 0011).
    orgUnitId: row.orgUnitId ?? "",
    projectId: row.projectId,
    contractId: row.contractId,
    // M5 and M6. The columns arrive with their tables; until then the answer
    // is null and not a guess (migration 0005 says the same).
    workOrderId: null,
    assetId: null,
    budgetLineId: row.budgetLineId,
    txnType: row.txnType,
    source: row.source,
    sourceRef: row.sourceRef ?? "",
    docDate: row.docDate,
    // A posting with no date is not a posting; the importer refuses one, and
    // the Excel migration dates its opening balance at the as-of date.
    postingDate: row.postingDate ?? row.docDate ?? "",
    amount: money(row.amount),
    currency: "EUR",
    description: row.description ?? "",
    vendorName: row.vendorName,
    sapWbs: row.sapWbs,
    sapPo: row.sapPo,
    costCentre: row.costCentre,
    glAccount: row.glAccount,
    importBatchId: row.importBatchId,
    matchedBy: row.matchedBy,
  };
}

export interface ImportBatchRow {
  id: string;
  source: string;
  report: ImportBatch["report"];
  fileName: string;
  fileSha256: string;
  profileId: string;
  period: string | null;
  rowsIn: number;
  rowsMatched: number;
  rowsUnmatched: number;
  rowsRejected: number;
  amountIn: string | number;
  amountMatched: string | number;
  status: ImportBatch["status"];
  importedById: string | null;
  importedByName: string | null;
  importedAt: Date;
  errorEl: string | null;
  errorEn: string | null;
}

export function toImportBatch(row: ImportBatchRow): ImportBatch {
  return {
    id: row.id,
    source: (row.source === "SAP_MCP" ? "SAP_MCP" : "SAP_EXTRACT") as ImportBatch["source"],
    report: row.report,
    fileName: row.fileName,
    fileSha256: row.fileSha256,
    profileId: row.profileId,
    period: row.period ?? "",
    rowsIn: row.rowsIn,
    rowsMatched: row.rowsMatched,
    rowsUnmatched: row.rowsUnmatched,
    rowsRejected: row.rowsRejected,
    amountIn: money(row.amountIn),
    amountMatched: money(row.amountMatched),
    status: row.status,
    importedById: row.importedById ?? "",
    importedByName: row.importedByName ?? "",
    importedAt: row.importedAt.toISOString(),
    errorEl: row.errorEl,
    errorEn: row.errorEn,
  };
}

export interface PaymentCertRow {
  id: string;
  contractId: string;
  orgUnitId: string;
  number: number;
  periodFrom: string;
  periodTo: string;
  workDoneValue: string | number;
  materialsOnSite: string | number;
  retentionHeld: string | number;
  previousCertified: string | number;
  netPayable: string | number;
  status: PaymentCert["status"];
  createdById: string;
  createdByName: string | null;
  approvedById: string | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  sapInvoiceRef: string | null;
  paidDate: string | null;
  retentionReleased: boolean;
}

export function toPaymentCert(row: PaymentCertRow): PaymentCert {
  return {
    id: row.id,
    contractId: row.contractId,
    orgUnitId: row.orgUnitId,
    number: row.number,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    workDoneValue: money(row.workDoneValue),
    materialsOnSite: money(row.materialsOnSite),
    retentionHeld: money(row.retentionHeld),
    previousCertified: money(row.previousCertified),
    netPayable: money(row.netPayable),
    status: row.status,
    createdById: row.createdById,
    createdByName: row.createdByName ?? "",
    approvedById: row.approvedById,
    approvedByName: row.approvedByName,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    sapInvoiceRef: row.sapInvoiceRef,
    paidDate: row.paidDate,
    retentionReleased: row.retentionReleased,
  };
}

/**
 * RULE (R11, and the comment on `PaymentCert` in packages/shared): the three
 * derived figures are the API's, never the caller's.
 *
 *   retentionHeld    = retentionPct × (workDone + materials)
 *   previousCertified = Σ (workDone + materials) of the earlier certificates
 *   netPayable       = workDone + materials − retentionHeld − previousCertified
 *
 * `workDoneValue` is cumulative to date, which is why `previousCertified`
 * comes straight off the top: the certificate pays for the difference.
 *
 * CAPEX-02 §7 keeps retention as its own line and never nets it silently, so
 * it is returned as well as subtracted.
 */
export function derivePaymentCert(input: {
  workDoneValue: number;
  materialsOnSite: number;
  retentionPct: number;
  previousCertified: number;
}): { retentionHeld: number; previousCertified: number; netPayable: number; gross: number } {
  const gross = round2(input.workDoneValue + input.materialsOnSite);
  const retentionHeld = round2((gross * input.retentionPct) / 100);
  const previousCertified = round2(input.previousCertified);
  return {
    gross,
    retentionHeld,
    previousCertified,
    netPayable: round2(gross - retentionHeld - previousCertified),
  };
}

export const DEFAULT_FORECAST_INPUTS: ForecastInputs = {
  contingency: 0,
  pendingVariationWeight: 0.5,
  contingencyNoteEl: null,
};

/**
 * R16, CAPEX-01 §7: "forecast final cost — committed + approved variations +
 * pending variations at a probability weight + a contingency the engineer
 * sets. Cost-to-complete = forecast − actual."
 *
 * The approved variations are already inside `committed`: `contract.
 * current_value` is the original value plus them (ADR-0015), and the SAP PO
 * balance is the commitment SAP holds. Adding them again would count every
 * approved change twice.
 *
 * RULE (the convention the whole cost screen keeps): a ledger with no source
 * is null, never zero. A project with no commitment, no pending variation and
 * no contingency has no forecast — saying €0 would read as "we expect this to
 * cost nothing", which is a different claim from "nobody has said yet".
 */
export function forecastOf(input: {
  committed: number | null;
  pendingVariations: number;
  inputs: ForecastInputs;
}): number | null {
  const weighted = round2(input.pendingVariations * input.inputs.pendingVariationWeight);
  const hasSource =
    input.committed !== null || weighted !== 0 || input.inputs.contingency !== 0;
  if (!hasSource) return null;
  return round2((input.committed ?? 0) + weighted + input.inputs.contingency);
}

export function costToCompleteOf(forecast: number | null, spent: number | null): number | null {
  if (forecast === null) return null;
  return round2(forecast - (spent ?? 0));
}

/** The variance S04 shows: forecast against approved (CAPEX-01 §7). */
export function varianceOf(forecast: number | null, approved: number | null): number | null {
  if (forecast === null || approved === null) return null;
  return round2(forecast - approved);
}

export interface CategoryTotals {
  approved: number | null;
  committed: number | null;
  spent: number | null;
  forecast: number | null;
}

/** One row of the category table, with its variance worked out. */
export function toCategoryRow(category: string, totals: CategoryTotals): CostCategoryRow {
  return {
    category,
    approved: totals.approved === null ? null : round2(totals.approved),
    committed: totals.committed === null ? null : round2(totals.committed),
    spent: totals.spent === null ? null : round2(totals.spent),
    forecast: totals.forecast === null ? null : round2(totals.forecast),
    variance: varianceOf(totals.forecast, totals.approved),
  };
}

/**
 * R18 — the year-end accrual: certified net less invoiced. Clamped to zero,
 * because a negative result is not an accrual, it is over-invoicing — the
 * organisation has been billed for more than it has certified, and that is
 * flagged rather than shown as a negative "amount owed" (screenshot review
 * 19/09/2026).
 */
export function accrualOf(certifiedNet: number, invoiced: number): { accrual: number; overInvoiced: boolean } {
  const raw = round2(certifiedNet - invoiced);
  return { accrual: Math.max(0, raw), overInvoiced: raw < 0 };
}

/** The order S04 reads the categories in; anything else follows, then the bucket. */
export function sortCategories(rows: CostCategoryRow[]): CostCategoryRow[] {
  const order = new Map<string, number>(COST_CATEGORIES.map((name, index) => [name, index]));
  return [...rows].sort((a, b) => {
    const left = a.category === UNCATEGORISED ? 99 : (order.get(a.category) ?? 90);
    const right = b.category === UNCATEGORISED ? 99 : (order.get(b.category) ?? 90);
    if (left !== right) return left - right;
    return a.category.localeCompare(b.category);
  });
}
