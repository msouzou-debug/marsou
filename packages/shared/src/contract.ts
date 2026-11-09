import { z } from "zod";
import { EFinanceContractSummary } from "./efinance";
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
  // ADR-0035: the sum of the approved extensions of time (`ContractExtension`
  // rows). Derived by the API, never typed; the database keeps it in step.
  extensionDays: z.number().int().nonnegative(),
  // ADR-0035: when the head of estates activated the delay penalty on the
  // contract's own clock (a contract without sections). Null until then.
  ldActivatedAt: z.string().nullable().default(null),
  ldActivationNoteEl: z.string().nullable().default(null),
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
// ------------------------------------------------------------ ADR-0035 --
// Sections, extensions of time, claims and the delay penalty. Built from the
// ΜΕΕ report of November 2026 on capital investments (docs/audit).

/**
 * A section of the works («Τμήμα Α», «Τμήμα Β») with its own contractual
 * completion date and its own delay clock. A contract without sections has
 * one clock, the contract's own. `handoverDate` is the actual date of the
 * Πιστοποιητικό Παραλαβής; the clock stops there.
 */
export const ContractSection = z.object({
  id: z.string(),
  contractId: z.string(),
  code: z.string().min(1).max(8), // «Α», «Β», «1»
  titleEl: z.string().min(1),
  completionDate: z.string(), // ISO date, contractual, before extensions
  handoverDate: z.string().nullable(),
  // Null means the contract's own rate applies to this section.
  liquidatedDamagesPerDay: z.number().nonnegative().nullable(),
  ldActivatedAt: z.string().nullable(),
  ldActivationNoteEl: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type ContractSection = z.infer<typeof ContractSection>;
export const ContractSectionWrite = ContractSection.pick({
  code: true,
  titleEl: true,
  completionDate: true,
  handoverDate: true,
  liquidatedDamagesPerDay: true,
  sortOrder: true,
});
export type ContractSectionWrite = z.infer<typeof ContractSectionWrite>;

/** Who approved an extension of time. ΤΕΑΑ and ΚΕΑΑ are the Organisation's committees. */
export const ExtensionApprover = z.enum(["TEAA", "KEAA", "ENGINEER", "OTHER"]);
export type ExtensionApprover = z.infer<typeof ExtensionApprover>;

/**
 * An approved extension of time (παράταση). One row per approval, with who
 * approved it, when, why, and whether the delay it covers is the
 * contractor's fault — the judgement the ΜΕΕ asks to see written down.
 * `sectionId` null means the contract's own clock.
 */
export const ContractExtension = z.object({
  id: z.string(),
  contractId: z.string(),
  sectionId: z.string().nullable(),
  days: z.number().int().positive(),
  approvedAt: z.string(), // ISO date
  approver: ExtensionApprover,
  approverNameEl: z.string().min(1),
  reasonEl: z.string().min(1),
  contractorCulpable: z.boolean(),
  documentId: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type ContractExtension = z.infer<typeof ContractExtension>;
export const ContractExtensionWrite = ContractExtension.pick({
  sectionId: true,
  days: true,
  approvedAt: true,
  approver: true,
  approverNameEl: true,
  reasonEl: true,
  contractorCulpable: true,
});
export type ContractExtensionWrite = z.infer<typeof ContractExtensionWrite>;

export const ClaimDirection = z.enum(["BY_CONTRACTOR", "BY_ORGANISATION"]);
export type ClaimDirection = z.infer<typeof ClaimDirection>;
export const ClaimStage = z.enum(["NOTIFIED", "UNDER_REVIEW", "NEGOTIATION", "ARBITRATION", "COURT", "SETTLED", "WITHDRAWN"]);
export type ClaimStage = z.infer<typeof ClaimStage>;
export const CLAIM_OPEN_STAGES: readonly ClaimStage[] = ["NOTIFIED", "UNDER_REVIEW", "NEGOTIATION", "ARBITRATION", "COURT"];

/**
 * A claim (αξίωση) on a contract, by the contractor or by the Organisation
 * (a counterclaim is a BY_ORGANISATION row). `contingentLiability` is the
 * flag finance reads for the notes to the financial statements.
 */
export const ContractClaim = z.object({
  id: z.string(),
  contractId: z.string(),
  direction: ClaimDirection,
  titleEl: z.string().min(1),
  amount: z.number().nonnegative(),
  stage: ClaimStage,
  notifiedAt: z.string().nullable(), // ISO date
  legalAdvisorEl: z.string().nullable(),
  contingentLiability: z.boolean(),
  notesEl: z.string(),
  documentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContractClaim = z.infer<typeof ContractClaim>;
export const ContractClaimWrite = ContractClaim.pick({
  direction: true,
  titleEl: true,
  amount: true,
  stage: true,
  notifiedAt: true,
  legalAdvisorEl: true,
  contingentLiability: true,
  notesEl: true,
});
export type ContractClaimWrite = z.infer<typeof ContractClaimWrite>;

/**
 * One delay clock, computed on read: the contract's own when it has no
 * sections, otherwise one per section. Days late run from the due date
 * (completion plus approved extensions on this clock) to the handover date,
 * or to `asOf` while the works are still open. The amount is days × rate,
 * null without a rate. Shown, never deducted: finance withholds it on the
 * payment certificate (owner decision, 09/11/2026).
 */
export const DelayClock = z.object({
  sectionId: z.string().nullable(),
  sectionCode: z.string().nullable(),
  titleEl: z.string(),
  completionDate: z.string().nullable(),
  extensionDays: z.number().int().nonnegative(),
  culpableExtensionDays: z.number().int().nonnegative(),
  dueDate: z.string().nullable(),
  handoverDate: z.string().nullable(),
  daysLate: z.number().int().nonnegative(),
  ratePerDay: z.number().nonnegative().nullable(),
  amount: z.number().nonnegative().nullable(),
  activatedAt: z.string().nullable(),
});
export type DelayClock = z.infer<typeof DelayClock>;

export const ContractDelay = z.object({
  asOf: z.string(), // ISO date the days were counted to
  clocks: z.array(DelayClock),
  totalDaysLate: z.number().int().nonnegative(),
  /** Null when no late clock has a rate. */
  totalAmount: z.number().nonnegative().nullable(),
  extensionDays: z.number().int().nonnegative(),
  openClaims: z.number().int().nonnegative(),
  claimedByContractor: z.number().nonnegative(),
  claimedByOrganisation: z.number().nonnegative(),
});
export type ContractDelay = z.infer<typeof ContractDelay>;

/** The approver's decision that the penalty runs from a date, on one clock. */
export const DelayActivation = z.object({
  sectionId: z.string().nullable(),
  activatedAt: z.string(), // ISO date
  noteEl: z.string().min(1),
});
export type DelayActivation = z.infer<typeof DelayActivation>;

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
    // ADR-0029. eFinance refused the push with 409 CONFLICT (the reference
    // exists there under another hospital or budget code) — a person
    // resolves it; or the contract cannot be pushed at all because it has
    // no budget code or its contractor has no SAP vendor code.
    "efinanceConflict",
    "efinanceNotPushable",
    // ADR-0035: a clock is past its due date with a rate, so the penalty is
    // accruing; and a claim is open against or by the Organisation.
    "delayPenaltyAccruing",
    "claimsOpen",
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
  // ADR-0029: the push state and eFinance's own figures for this contract.
  // Null when eFinance is not configured. Optional for the same reason as
  // the three above: fixtures written before it do not carry it.
  efinance: EFinanceContractSummary.nullable().optional(),
  // ADR-0035. Optional for the same fixture reason; the API always sends all four.
  sections: z.array(ContractSection).optional(),
  extensions: z.array(ContractExtension).optional(),
  claims: z.array(ContractClaim).optional(),
  delay: ContractDelay.optional(),
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

// ADR-0035: `extensionDays` left this shape; an extension is a record now.
export const ContractUpdate = ContractCreate.omit({ projectId: true, contractorId: true, originalValue: true }).partial();
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
