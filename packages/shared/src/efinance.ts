import { z } from "zod";

// ------------------------------------------------------------ eFinance (ADR-0029)
// Two layers, kept apart on purpose.
//
//  1. The RAW shapes, spelled exactly as eFinance's integration record spells
//     them (docs/integration/eFinance-integration-record.md): snake_case,
//     money as 2-decimal strings, `null` for an unknown amount, timestamps
//     with an explicit offset. The API's EFinanceClient validates every
//     answer against these and hands them on unchanged; nothing is turned
//     into a number at this layer.
//  2. The eCapital-facing DTOs the web app reads: camelCase, money as numbers
//     (parsed once, at the edge), and `null` wherever eFinance has no figure
//     or is not configured. Null is never zero (ADR-0021 §7).

// ---------------------------------------------------------------- raw layer --

/** Record §2: "strings, always 2 decimals, `.` as the decimal separator". */
export const EFinanceMoney = z.string().regex(/^-?\d+\.\d{2}$/);
/** Record §2: "an unknown amount is `null`". */
export const EFinanceAmount = EFinanceMoney.nullable();

/** An id or a quantity that eFinance may send as a number or as a string. */
const Scalar = z.union([z.string(), z.number()]).transform((value) => String(value));
const OptionalText = z.string().nullable().optional();

/** Record §2: the one error envelope every route answers with. */
export const EFinanceErrorCode = z.enum([
  "UNAUTHENTICATED",
  "LOOPBACK_ONLY",
  "NOT_FOUND",
  "SCHEMA_INVALID",
  "CONFLICT",
]);
export type EFinanceErrorCode = z.infer<typeof EFinanceErrorCode>;

export const EFinanceErrorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string().optional().default("") }),
});
export type EFinanceErrorEnvelope = z.infer<typeof EFinanceErrorEnvelope>;

// §3 GET /api/v1/master/entities
export const EFinanceRawEntity = z.object({
  code: z.string(),
  archive_code: z.string().nullable(),
  name: z.string(),
  type: z.string().nullable().optional(),
  active: z.boolean(),
});
export type EFinanceRawEntity = z.infer<typeof EFinanceRawEntity>;

// §3 GET /api/v1/master/cost-centres?entity=
export const EFinanceRawCostCentre = z.object({
  code: z.string(),
  name: z.string(),
  entity_code: z.string(),
  active: z.boolean(),
});
export type EFinanceRawCostCentre = z.infer<typeof EFinanceRawCostCentre>;

// §3 GET /api/v1/master/budget-codes?kind=capex. `name` was added for
// eCapital on 02/10/2026 (INTEGRATION §5); the display name prefers it.
export const EFinanceRawBudgetCode = z.object({
  code: z.string(),
  description: z.string().nullable(),
  name: OptionalText,
  category: z.string().nullable(),
  kind: z.enum(["capex", "opex"]),
  active: z.boolean(),
});
export type EFinanceRawBudgetCode = z.infer<typeof EFinanceRawBudgetCode>;

// §3 GET /api/v1/master/vendors (paged). `code` and `vat_no` are the
// spellings eFinance added on 02/10/2026; the record's own are kept first.
export const EFinanceRawVendor = z
  .object({
    vendor_code: z.string().optional(),
    code: z.string().optional(),
    name: z.string(),
    vat: OptionalText,
    vat_no: OptionalText,
    blocked: z.boolean(),
    active: z.boolean(),
    sap_batch: Scalar.nullable().optional(),
  })
  .refine((vendor) => Boolean(vendor.vendor_code ?? vendor.code), { message: "vendor_code" });
export type EFinanceRawVendor = z.infer<typeof EFinanceRawVendor>;

// §3 GET /api/v1/budget/position?year=&entity=&code=
export const EFinanceRawBudgetPositionRow = z.object({
  budget_code: z.string(),
  entity_code: z.string(),
  archive_code: z.string().nullable().optional(),
  year: z.number().int(),
  allocated: EFinanceAmount,
  booked: EFinanceAmount,
  in_flight: EFinanceAmount,
  requisitions: EFinanceAmount,
  available: EFinanceAmount,
});
export type EFinanceRawBudgetPositionRow = z.infer<typeof EFinanceRawBudgetPositionRow>;

export const EFinanceLedger = z.enum(["booked", "in_flight", "reversed", "rejected"]);
export type EFinanceLedger = z.infer<typeof EFinanceLedger>;

// §3 invoice lines. "Take spend from the lines, never the header."
export const EFinanceRawInvoiceLine = z.object({
  descr: z.string().nullable(),
  qty: Scalar.nullable(),
  unit_price: EFinanceAmount,
  line_total: EFinanceAmount,
  vat_rate: Scalar.nullable(),
  gl_account: z.string().nullable(),
  cost_centre: z.string().nullable(),
  budget_code: z.string().nullable(),
  wbs_code: z.string().nullable(),
});
export type EFinanceRawInvoiceLine = z.infer<typeof EFinanceRawInvoiceLine>;

// §3 GET /api/v1/capital/invoices?ref= | ?updated_since=
export const EFinanceRawInvoice = z.object({
  id: Scalar,
  invoice_no: z.string().nullable(),
  invoice_date: z.string().nullable(),
  sap_batch_date: z.string().nullable(),
  vendor_code: z.string().nullable(),
  vendor_name: z.string().nullable(),
  entity_code: z.string().nullable(),
  currency: z.string(),
  net: EFinanceAmount,
  vat: EFinanceAmount,
  gross: EFinanceAmount,
  status: z.string().nullable(),
  ledger: EFinanceLedger,
  cap_ref: z.string().nullable(),
  reversed_at: z.string().nullable(),
  reversal_sap_doc_no: z.string().nullable(),
  reversal_reason: z.string().nullable(),
  updated_at: z.string(),
  lines: z.array(EFinanceRawInvoiceLine),
});
export type EFinanceRawInvoice = z.infer<typeof EFinanceRawInvoice>;

// §3 GET /api/v1/capital/requisitions?ref= | ?updated_since=
export const EFinanceRawRequisition = z.object({
  id: Scalar,
  number: z.string(),
  description: z.string().nullable(),
  justification: z.string().nullable(),
  entity_code: z.string().nullable(),
  cost_centre: z.string().nullable(),
  budget_code: z.string().nullable(),
  gl_account: z.string().nullable(),
  amount: EFinanceAmount,
  currency: z.string(),
  status: z.string(),
  cap_ref: z.string().nullable(),
  po_number: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type EFinanceRawRequisition = z.infer<typeof EFinanceRawRequisition>;

// §4 PUT /api/v1/capital/contracts/{cap_ref} — the one write.
export const EFINANCE_CAP_REF = /^CAP-\d{4}-\d{4,}$/;
export const EFinanceContractPut = z.object({
  project_ref: z.string(),
  title: z.string(),
  entity_code: z.string(),
  budget_code: z.string(),
  vendor_code: z.string(),
  current_value: EFinanceMoney,
  status: z.enum(["active", "closed"]),
  updated_at: z.string(),
});
export type EFinanceContractPut = z.infer<typeof EFinanceContractPut>;

export const EFinanceRawSpend = z.object({
  booked: EFinanceAmount,
  in_flight: EFinanceAmount,
  requisitions: EFinanceAmount,
});
export type EFinanceRawSpend = z.infer<typeof EFinanceRawSpend>;

// §4: the PUT answers `current_value`, `spend` and `remaining`; the GET
// answers the stored copy plus the same figures.
export const EFinanceRawContractSpend = z.object({
  cap_ref: z.string().optional(),
  current_value: EFinanceAmount,
  spend: EFinanceRawSpend,
  remaining: EFinanceAmount,
});
export type EFinanceRawContractSpend = z.infer<typeof EFinanceRawContractSpend>;

// ------------------------------------------------------------ eCapital DTOs --

/**
 * The eFinance figures on one contract, or summed over a project's contracts.
 * `booked` is spend, `inFlight` is forecast only (never committed, never
 * spent), `requisitions` is eFinance's own commitment — never added to
 * eCapital's committed ledger (ADR-0015) — and `remaining` is eFinance's
 * `current_value − booked − requisitions`. The whole object is null when
 * eFinance is not configured.
 */
export const EFinanceContractSummary = z.object({
  pushedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  booked: z.number().nullable(),
  inFlight: z.number().nullable(),
  requisitions: z.number().nullable(),
  remaining: z.number().nullable(),
  lastSyncAt: z.string().nullable(),
});
export type EFinanceContractSummary = z.infer<typeof EFinanceContractSummary>;

// GET /contracts/:id/efinance and POST /contracts/:id/efinance/push.
export const EFinanceContractStatus = EFinanceContractSummary.extend({
  configured: z.boolean(),
  capRef: z.string(),
});
export type EFinanceContractStatus = z.infer<typeof EFinanceContractStatus>;

export const EFinanceInvoiceLine = z.object({
  index: z.number().int().nonnegative(),
  descr: z.string().nullable(),
  qty: z.number().nullable(),
  unitPrice: z.number().nullable(),
  lineTotal: z.number().nullable(),
  vatRate: z.number().nullable(),
  glAccount: z.string().nullable(),
  costCentre: z.string().nullable(),
  budgetCode: z.string().nullable(),
  wbsCode: z.string().nullable(),
});
export type EFinanceInvoiceLine = z.infer<typeof EFinanceInvoiceLine>;

export const EFinanceInvoice = z.object({
  id: z.string(),
  invoiceNo: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  sapBatchDate: z.string().nullable(),
  vendorCode: z.string().nullable(),
  vendorName: z.string().nullable(),
  entityCode: z.string().nullable(),
  currency: z.string(),
  net: z.number().nullable(),
  vat: z.number().nullable(),
  gross: z.number().nullable(),
  status: z.string().nullable(),
  // RULE (record §3): only `booked` is spend. `reversed` stays here, in the
  // history, with its reason; it is never summed.
  ledger: EFinanceLedger,
  capRef: z.string().nullable(),
  reversedAt: z.string().nullable(),
  reversalSapDocNo: z.string().nullable(),
  reversalReason: z.string().nullable(),
  updatedAt: z.string(),
  lines: z.array(EFinanceInvoiceLine),
});
export type EFinanceInvoice = z.infer<typeof EFinanceInvoice>;

export const EFinanceInvoiceList = z.object({
  configured: z.boolean(),
  items: z.array(EFinanceInvoice),
  total: z.number().int(),
});
export type EFinanceInvoiceList = z.infer<typeof EFinanceInvoiceList>;

export const EFinanceRequisition = z.object({
  id: z.string(),
  number: z.string(),
  description: z.string().nullable(),
  justification: z.string().nullable(),
  entityCode: z.string().nullable(),
  costCentre: z.string().nullable(),
  budgetCode: z.string().nullable(),
  glAccount: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string(),
  status: z.string(),
  capRef: z.string().nullable(),
  poNumber: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EFinanceRequisition = z.infer<typeof EFinanceRequisition>;

export const EFinanceRequisitionList = z.object({
  configured: z.boolean(),
  items: z.array(EFinanceRequisition),
  total: z.number().int(),
});
export type EFinanceRequisitionList = z.infer<typeof EFinanceRequisitionList>;

/**
 * INTEGRATION §5's mapping: allocated → budget, booked → spent, requisitions
 * → committed on eFinance's side, inFlight → forecast only (never committed),
 * available = allocated − booked − requisitions, as eFinance computes it.
 */
export const BudgetPosition = z.object({
  budgetCode: z.string(),
  entityCode: z.string(),
  year: z.number().int(),
  allocated: z.number().nullable(),
  booked: z.number().nullable(),
  requisitions: z.number().nullable(),
  inFlight: z.number().nullable(),
  available: z.number().nullable(),
  asOf: z.string().nullable(),
});
export type BudgetPosition = z.infer<typeof BudgetPosition>;

// GET /contracts/:id/budget-position — `position` is null when eFinance is
// not configured, or when the contract has no budget code to ask about.
export const ContractBudgetPosition = z.object({
  configured: z.boolean(),
  position: BudgetPosition.nullable(),
});
export type ContractBudgetPosition = z.infer<typeof ContractBudgetPosition>;

// GET /projects/:id/budget-position — one row per (budget code, year) the
// project's contracts are charged to. Never summed across codes.
export const ProjectBudgetPosition = z.object({
  configured: z.boolean(),
  items: z.array(BudgetPosition),
});
export type ProjectBudgetPosition = z.infer<typeof ProjectBudgetPosition>;

export const EFinanceFeedResult = z.object({
  rows: z.number().int().nonnegative(),
  cursor: z.string().nullable(),
  error: z.string().nullable(),
});
export type EFinanceFeedResult = z.infer<typeof EFinanceFeedResult>;

// POST /admin/efinance/sync
export const EFinanceSyncResult = z.object({
  configured: z.boolean(),
  invoices: EFinanceFeedResult,
  requisitions: EFinanceFeedResult,
  // Contracts whose spend figures were read back from eFinance this run.
  contractsRefreshed: z.number().int().nonnegative(),
  ranAt: z.string(),
});
export type EFinanceSyncResult = z.infer<typeof EFinanceSyncResult>;

// POST /admin/efinance/sync-master
export const EFinanceMasterSyncResult = z.object({
  configured: z.boolean(),
  unitsMatched: z.number().int().nonnegative(),
  vendorsUpserted: z.number().int().nonnegative(),
  vendorsDeactivated: z.number().int().nonnegative(),
  error: z.string().nullable(),
  ranAt: z.string(),
});
export type EFinanceMasterSyncResult = z.infer<typeof EFinanceMasterSyncResult>;

// GET /efinance/vendors?q= — the contractor form's vendor search.
export const EFinanceVendor = z.object({
  vendorCode: z.string(),
  name: z.string(),
  vat: z.string().nullable(),
  blocked: z.boolean(),
  active: z.boolean(),
});
export type EFinanceVendor = z.infer<typeof EFinanceVendor>;

export const EFinanceVendorList = z.object({
  items: z.array(EFinanceVendor),
});
export type EFinanceVendorList = z.infer<typeof EFinanceVendorList>;

// The two contract warnings this integration adds (ADR-0029). Both are
// warn-and-flag: a person resolves them; nothing is blocked.
export const EFINANCE_WARNING_KEYS = ["efinanceConflict", "efinanceNotPushable"] as const;
export const EFinanceWarningKey = z.enum(EFINANCE_WARNING_KEYS);
export type EFinanceWarningKey = z.infer<typeof EFinanceWarningKey>;
