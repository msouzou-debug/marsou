import { z } from "zod";
import { Defect } from "./site";

// ------------------------------------------------------------ M1 (R08–R10)
// CAPEX-01 §4 contractor / contract / boq_item / variation. Glossary
// (CAPEX-02 §7): Σύμβαση, Ανάδοχος, Τροποποίηση σύμβασης, Κρατήσεις.
// The tender stage stays in e-Procurement: a contract starts at award.

export const ContractorCategory = z.enum([
  "BUILDING",
  "MECHANICAL",
  "ELECTRICAL",
  "BIOMEDICAL",
  "IT",
  "CONSULTANT",
  "OTHER",
]);
export type ContractorCategory = z.infer<typeof ContractorCategory>;

export const Contractor = z.object({
  id: z.string(),
  name: z.string(),
  vatNumber: z.string().nullable(),
  registrationNo: z.string().nullable(),
  category: ContractorCategory,
  sapVendorId: z.string().nullable(),
  // RULE: a blacklisted contractor cannot be given a new contract; existing
  // contracts continue. The API refuses with errors.contractorBlacklisted.
  blacklisted: z.boolean(),
});
export type Contractor = z.infer<typeof Contractor>;

export const ContractType = z.enum(["LUMP_SUM", "BOQ", "FRAMEWORK", "MEASURE_TERM", "SUPPLY", "SERVICE"]);
export type ContractType = z.infer<typeof ContractType>;

// ADR-0019. eCapital's own reference for a contract: CAP-<YEAR>-<NNNN>,
// allocated by the API, unique across the organisation and never changed.
// eFinance routes a `contract_ref` by prefix — CON- to eMAP, CAP- to here —
// so the shape is part of the integration contract, not decoration.
export const CONTRACT_REF = /^CAP-\d{4}-\d{4}$/;

// eMAP's own contract reference, CON-<YEAR>-<NNNN> (INTEGRATION-eMAP §4).
// Typed by a person on the contract form, so it is validated rather than
// trusted: a mistyped reference makes a link that lands nowhere.
export const EMAP_CONTRACT_REF = /^CON-\d{4}-\d{4}$/;

export const Contract = z.object({
  id: z.string(),
  projectId: z.string(),
  orgUnitId: z.string(),
  contractorId: z.string(),
  contractorName: z.string(),
  // RULE (ADR-0019): allocated by the API inside the create transaction,
  // unique, immutable. `contractNo` below is the legal number off the tender
  // papers and stays whatever the user typed — the two are not the same
  // thing and neither replaces the other.
  ref: z.string().regex(CONTRACT_REF),
  contractNo: z.string(),
  type: ContractType,
  awardDate: z.string(), // ISO date
  awardDecisionDocId: z.string().nullable(), // M8 document; null until then
  originalValue: z.number().nonnegative(),
  // RULE (CAPEX-01 §7): currentValue = originalValue + approved variations.
  // Derived by the API, never typed.
  currentValue: z.number().nonnegative(),
  currency: z.literal("EUR"),
  startDate: z.string().nullable(),
  completionDate: z.string().nullable(),
  extensionDays: z.number().int().nonnegative(),
  retentionPct: z.number().min(0).max(100),
  performanceBondValue: z.number().nonnegative().nullable(),
  bondExpiry: z.string().nullable(),
  liquidatedDamagesPerDay: z.number().nonnegative().nullable(),
  defectsLiabilityMonths: z.number().int().nonnegative(),
  sapPoNumber: z.string().nullable(),
  // ADR-0019: the eMAP contract this one was procured under, when there is
  // one. Null until somebody types it; the link-out to eMAP appears either
  // from here or from a `contractNo` that is already a CON- reference.
  emapRef: z.string().regex(EMAP_CONTRACT_REF).nullable().default(null),
  // ADR-0025, owner decision 19/09/2026: one CAPEX budget code per contract,
  // from ecapital.budget_code. Null on a contract recorded before this field
  // existed; the API refuses to leave it null on a brand-new one.
  budgetCode: z.string().nullable().default(null),
  createdAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});
export type Contract = z.infer<typeof Contract>;

export const BoqItem = z.object({
  id: z.string(),
  contractId: z.string(),
  itemNo: z.string(),
  descriptionEl: z.string(),
  unit: z.string(),
  qty: z.number(),
  rate: z.number(),
  amount: z.number(), // qty × rate, derived
});
export type BoqItem = z.infer<typeof BoqItem>;

export const VariationReason = z.enum(["CLIENT_CHANGE", "SITE_CONDITION", "DESIGN_ERROR", "STATUTORY", "OTHER"]);
export type VariationReason = z.infer<typeof VariationReason>;

// DRAFT → SUBMITTED → APPROVED | RETURNED (back to the raiser, editable
// again) | REJECTED (final). Only APPROVED counts in currentValue.
export const VariationStatus = z.enum(["DRAFT", "SUBMITTED", "APPROVED", "RETURNED", "REJECTED"]);
export type VariationStatus = z.infer<typeof VariationStatus>;

export const Variation = z.object({
  id: z.string(),
  contractId: z.string(),
  number: z.number().int(), // per contract, 1..n, allocated by the API
  descriptionEl: z.string(),
  reason: VariationReason,
  value: z.number(), // may be negative (omission)
  timeImpactDays: z.number().int(),
  status: VariationStatus,
  raisedById: z.string(),
  raisedByName: z.string(),
  raisedAt: z.string(),
  // RULE (R10, CAPEX-01 §10): the approver is never the raiser. The API
  // refuses with errors.sameUserApproval.
  decidedById: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionCommentEl: z.string().nullable(),
});
export type Variation = z.infer<typeof Variation>;

// Warn-and-flag (R31): fires on the project, never blocks.
export const ContractWarning = z.object({
  // `instructionsWithoutVariation` is the R09 rule: a site instruction with
  // cost impact has to end up as a variation, and one that has not been
  // turned into one yet is work the contractor is doing that the commitment
  // does not know about.
  key: z.enum([
    "variationsOverTenPct",
    "bondExpired",
    "completionPast",
    "instructionsWithoutVariation",
  ]),
  sentenceEl: z.string(),
  sentenceEn: z.string(),
  amount: z.number().nullable(),
});
export type ContractWarning = z.infer<typeof ContractWarning>;

// S07 contract detail: one call.
export const ContractDetail = Contract.extend({
  project: z.object({ id: z.string(), code: z.string(), titleEl: z.string() }),
  contractor: Contractor,
  // The two descriptions of `budgetCode`, so S07 shows the Greek and English
  // text without a second call to `GET /budget-codes`. Both null when
  // `budgetCode` itself is null.
  budgetCodeDescriptionEl: z.string().nullable(),
  budgetCodeDescriptionEn: z.string().nullable(),
  boq: z.array(BoqItem),
  variations: z.array(Variation),
  approvedVariationsTotal: z.number(),
  pendingVariationsTotal: z.number(),
  variationPctOfOriginal: z.number(), // approved ÷ original × 100
  warnings: z.array(ContractWarning),
  // M1 site logs (R09, R12). Optional for the same reason `UnitRow.committed`
  // is: the contract screen and its fixtures shipped before the site log did,
  // and they do not carry these. The API always sends all three.
  defects: z.array(Defect).optional(),
  rfisOpen: z.number().int().nonnegative().optional(),
  rfisBreached: z.number().int().nonnegative().optional(),
});
export type ContractDetail = z.infer<typeof ContractDetail>;

export const ContractList = z.object({
  items: z.array(Contract),
  total: z.number().int(),
});
export type ContractList = z.infer<typeof ContractList>;

// Writes
export const ContractorCreate = Contractor.omit({ id: true, blacklisted: true });
export type ContractorCreate = z.infer<typeof ContractorCreate>;

export const ContractCreate = Contract.pick({
  projectId: true,
  contractorId: true,
  contractNo: true,
  type: true,
  awardDate: true,
  originalValue: true,
  startDate: true,
  completionDate: true,
  retentionPct: true,
  performanceBondValue: true,
  bondExpiry: true,
  liquidatedDamagesPerDay: true,
  defectsLiabilityMonths: true,
  sapPoNumber: true,
  emapRef: true,
  // ADR-0025, owner decision 19/09/2026: nullable at this level, like on
  // `Contract` itself — a caller that has not resolved a code yet (or an
  // older integration) may still send null. `errors.budgetCodeNotFound` is
  // what the API answers when a non-null value does not name an active row
  // in ecapital.budget_code. S07a's own form tightens this to "required" for
  // a human creating a contract (schema.ts), which is a stricter check on
  // top of this one, not a relaxation of it.
  budgetCode: true,
});
export type ContractCreate = z.infer<typeof ContractCreate>;

export const ContractUpdate = ContractCreate.omit({ projectId: true, contractorId: true, originalValue: true })
  .extend({ extensionDays: z.number().int().nonnegative().optional() })
  .partial();
export type ContractUpdate = z.infer<typeof ContractUpdate>;

// GET /contracts — the register across every project the caller may see.
// `unit` narrows to one org unit, `q` searches the two references and the
// contractor's name without regard to case or accents.
export const ContractListQuery = z.object({
  unit: z.string().optional(),
  q: z.string().optional(),
});
export type ContractListQuery = z.infer<typeof ContractListQuery>;

// GET /contracts/lookup?q= — what eFinance's link lands on. One id or a 404;
// nothing else, because the caller is a redirect and not a screen.
export const ContractLookup = z.object({ id: z.string() });
export type ContractLookup = z.infer<typeof ContractLookup>;

export const BoqItemWrite = BoqItem.omit({ id: true, contractId: true, amount: true });
export type BoqItemWrite = z.infer<typeof BoqItemWrite>;

export const VariationCreate = Variation.pick({
  descriptionEl: true,
  reason: true,
  value: true,
  timeImpactDays: true,
});
export type VariationCreate = z.infer<typeof VariationCreate>;

// submit: DRAFT|RETURNED → SUBMITTED (raiser). decide: SUBMITTED → APPROVED |
// RETURNED | REJECTED (a different user, estates_head or admin); a comment is
// required for RETURNED and REJECTED (Επιστροφή με σχόλια).
export const VariationDecision = z.object({
  decision: z.enum(["APPROVED", "RETURNED", "REJECTED"]),
  commentEl: z.string().nullable(),
});
export type VariationDecision = z.infer<typeof VariationDecision>;
