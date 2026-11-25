/**
 * Building the `meta` part out of what eCapital already knows.
 *
 * Pure functions, no database and no HTTP, because this is the part of the
 * eArchive contract most likely to be read by somebody checking a sample
 * against a real request: the subject a clerk would have written on the
 * folder, the money in the spelling the errata settled («1.234,56 €»), the
 * folder hint that is the unit's own code since ADR-0024, the vendor code
 * that is SAP's, and the approvals taken from the audit trail rather than
 * retyped.
 *
 * NO PATIENT DATA. `personal_data` is false on every item built here. An
 * award decision, a business case and an approved variation are about money,
 * dates and a company; there is nothing about a person in any of them beyond
 * the name of the member of staff who approved it, which is what
 * `approvals[]` is for and which is staff data, not patient data.
 */
import { z } from "zod";
import {
  type DmsFile,
  type DmsMetaBody,
  DmsApproval,
  DmsCounterparty,
  DmsMetaBody as DmsMetaBodySchema,
  RETENTION_CLASS_HINT,
  REGISTRY_HINT,
  SENDER_TECHNICAL_SERVICES,
  SOURCE_SYSTEM,
  isoWithOffset,
  moneyInText,
} from "./earchive-contract";

/** The Greek words that go on the protocol. Not i18n keys: eArchive's
 * registry is Greek and a document type in English would be filed under a
 * name no clerk searches for. ADR-0023 §«Strings». */
export const DOC_TYPE = {
  award: "Απόφαση κατακύρωσης",
  business_case: "Μελέτη σκοπιμότητας",
  variation: "Εγκεκριμένη τροποποίηση σύμβασης",
} as const;

/**
 * R28, M4: the six kinds of paper an asset carries, in the Greek a clerk
 * searching eArchive's registry would type. Not i18n keys, for the reason
 * ADR-0023 §«Strings» gives — a document type that changed language with the
 * caller's Accept-Language header is a document type nobody can find.
 *
 * The category is eArchive's own: a commissioning pack, a certificate and a
 * warranty come out of a contract and file under «Συμβάσεις»; a manual, a
 * drawing and a photograph are the estate's own papers and file under
 * «Διοίκηση».
 */
export const ASSET_DOC_TYPE = {
  OM_MANUAL: "Εγχειρίδιο λειτουργίας και συντήρησης",
  CERT: "Πιστοποιητικό εξοπλισμού",
  COMMISSIONING: "Φάκελος παραλαβής και θέσης σε λειτουργία",
  WARRANTY: "Εγγύηση εξοπλισμού",
  DRAWING: "Σχέδιο εξοπλισμού",
  PHOTO: "Φωτογραφία εξοπλισμού",
} as const;

export type AssetDocumentKindKey = keyof typeof ASSET_DOC_TYPE;

const ASSET_DOC_CATEGORY: Record<AssetDocumentKindKey, "Συμβάσεις" | "Διοίκηση"> = {
  COMMISSIONING: "Συμβάσεις",
  CERT: "Συμβάσεις",
  WARRANTY: "Συμβάσεις",
  OM_MANUAL: "Διοίκηση",
  DRAWING: "Διοίκηση",
  PHOTO: "Διοίκηση",
};

const ACTION = {
  recorded: "Καταχώριση",
  submitted: "Υποβολή",
  approved: "Έγκριση",
} as const;

export interface UnitFacts {
  /** Since ADR-0024 this is eArchive's site code, with nothing in between. */
  code: string;
  nameEl: string;
}

export interface ContractorFacts {
  id: string;
  name: string;
  vatNumber: string | null;
  registrationNo: string | null;
  sapVendorId: string | null;
}

export interface PersonAction {
  name: string;
  role: string;
  action: keyof typeof ACTION;
  at: Date;
  comment?: string | null;
}

export interface AwardFacts {
  contractId: string;
  ref: string;
  contractNo: string;
  awardDate: string;
  originalValue: number;
  projectTitleEl: string;
  unit: UnitFacts;
  contractor: ContractorFacts;
  approvals: PersonAction[];
}

export interface BusinessCaseFacts {
  projectId: string;
  code: string;
  titleEl: string;
  approvedBudget: number;
  letterDate: string;
  unit: UnitFacts;
  approvals: PersonAction[];
}

export interface VariationFacts {
  contractId: string;
  contractRef: string;
  number: number;
  descriptionEl: string;
  value: number;
  letterDate: string;
  unit: UnitFacts;
  contractor: ContractorFacts;
  approvals: PersonAction[];
}

/**
 * The key eArchive files by, and the only thing that makes a correction a
 * different document rather than an edit of one that is already protocolled.
 * Version 1 is the scheme the brief gives verbatim; a correction adds `:vN`,
 * which keeps the stem searchable and the string unique (ADR-0023).
 */
export function sourceRefFor(base: string, version: number): string {
  return version <= 1 ? base : `${base}:v${version}`;
}

export function awardSourceRef(contractId: string, version = 1): string {
  return sourceRefFor(`award:${contractId}`, version);
}
export function businessCaseSourceRef(projectCode: string, version = 1): string {
  return sourceRefFor(`business_case:${projectCode}`, version);
}
export function variationSourceRef(contractRef: string, number: number, version = 1): string {
  return sourceRefFor(`variation:${contractRef}:${number}`, version);
}

/**
 * R28: `asset_doc:<asset_id>:<n>`, the nth paper filed against this asset.
 *
 * The `:vN` suffix the other three carry is not used here and is not needed:
 * each paper is a different document — a manual is not a correction of a
 * certificate — so the running number is what makes the reference unique. A
 * corrected manual is the next n, with a SUPERSEDES relation at the one it
 * replaces, which is the same rule stated a different way (ADR-0023 §6).
 */
export function assetDocumentSourceRef(assetId: string, n: number): string {
  return `asset_doc:${assetId}:${n}`;
}

/** A deep link to the eCapital page a reader of the protocol would want. */
function deepLink(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path}`.slice(0, 500);
}

/**
 * A vendor needs a code eArchive can file it under. SAP's vendor id is the
 * one every other system already uses (R14, ADR-0021), then the registrar's
 * number, and only if a contractor has neither does eCapital fall back to its
 * own row id — prefixed, so nobody mistakes it for somebody else's key.
 */
export function vendorCounterparty(contractor: ContractorFacts): z.infer<typeof DmsCounterparty> {
  const code =
    contractor.sapVendorId?.trim() ||
    contractor.registrationNo?.trim() ||
    `ecapital:${contractor.id}`;
  const counterparty: z.infer<typeof DmsCounterparty> = {
    type: "vendor",
    code: code.slice(0, 60),
    name: contractor.name.slice(0, 200),
  };
  const vat = contractor.vatNumber?.trim();
  return vat ? { ...counterparty, vat: vat.slice(0, 40) } : counterparty;
}

function approvalsOf(actions: PersonAction[]): z.infer<typeof DmsApproval>[] {
  return actions.slice(0, 20).map((action) => {
    const approval: z.infer<typeof DmsApproval> = {
      actor_name: action.name.slice(0, 200),
      role: action.role.slice(0, 80),
      action: ACTION[action.action],
      at: isoWithOffset(action.at),
    };
    const comment = action.comment?.trim();
    return comment ? { ...approval, comment: comment.slice(0, 2000) } : approval;
  });
}

/** 3–500 characters, and the interesting part first — a subject line that is
 * cut off in a list should still say what the paper is. */
function subject(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" — ")
    .slice(0, 500);
}

function commonFacts(unit: UnitFacts) {
  return {
    schema_version: 1 as const,
    source_system: SOURCE_SYSTEM,
    registry_hint: REGISTRY_HINT,
    retention_class_hint: RETENTION_CLASS_HINT,
    direction: "INTERNAL" as const,
    classification: "BUSINESS" as const,
    // NO PATIENT DATA, and no staff personal data either: what goes is a
    // name against an approval, which eArchive treats as business metadata.
    personal_data: false,
    sender_name: SENDER_TECHNICAL_SERVICES,
    currency: "EUR" as const,
    folder_hints: [{ hospital: unit.code, title: unit.nameEl }],
  };
}

/** Everything built here goes through the strict schema before it is stored,
 * so a field eArchive would refuse fails at the upload and not at the send. */
function checked(meta: unknown): DmsMetaBody {
  return DmsMetaBodySchema.parse(meta);
}

export function buildAwardMeta(
  facts: AwardFacts,
  files: DmsFile[],
  origin: string,
  version = 1,
): DmsMetaBody {
  const sourceRef = awardSourceRef(facts.contractId, version);
  return checked({
    ...commonFacts(facts.unit),
    source_module: "award",
    source_ref: sourceRef,
    source_url: deepLink(origin, `/contracts/${facts.contractId}`),
    doc_type: DOC_TYPE.award,
    subject: subject([
      DOC_TYPE.award,
      facts.ref,
      facts.projectTitleEl,
      facts.contractor.name,
      moneyInText(facts.originalValue),
    ]),
    sender_ref: facts.contractNo.slice(0, 120),
    letter_date: facts.awardDate,
    event_date: facts.awardDate,
    category: "Συμβάσεις",
    counterparties: [vendorCounterparty(facts.contractor)],
    amount: round2(facts.originalValue),
    related: supersedes(awardSourceRef(facts.contractId, version - 1), version),
    approvals: approvalsOf(facts.approvals),
    files,
  });
}

export function buildBusinessCaseMeta(
  facts: BusinessCaseFacts,
  files: DmsFile[],
  origin: string,
  version = 1,
): DmsMetaBody {
  return checked({
    ...commonFacts(facts.unit),
    source_module: "business_case",
    source_ref: businessCaseSourceRef(facts.code, version),
    source_url: deepLink(origin, `/projects/${facts.projectId}`),
    doc_type: DOC_TYPE.business_case,
    subject: subject([
      DOC_TYPE.business_case,
      facts.code,
      facts.titleEl,
      moneyInText(facts.approvedBudget),
    ]),
    sender_ref: facts.code.slice(0, 120),
    letter_date: facts.letterDate,
    // «Διοίκηση», not «Συμβάσεις»: a business case is what the organisation
    // decided to do, before there is any contract to file it under.
    category: "Διοίκηση",
    counterparties: [],
    amount: round2(facts.approvedBudget),
    related: supersedes(businessCaseSourceRef(facts.code, version - 1), version),
    approvals: approvalsOf(facts.approvals),
    files,
  });
}

export function buildVariationMeta(
  facts: VariationFacts,
  files: DmsFile[],
  origin: string,
  version = 1,
): DmsMetaBody {
  // RULE (eArchive brief): an approved variation always points back at the
  // award it changes, so the two are one story in the registry.
  const related = [
    { source_ref: `award:${facts.contractId}`, relation: "RELATED" as const },
    ...supersedes(variationSourceRef(facts.contractRef, facts.number, version - 1), version),
  ];
  return checked({
    ...commonFacts(facts.unit),
    source_module: "variation",
    source_ref: variationSourceRef(facts.contractRef, facts.number, version),
    source_url: deepLink(origin, `/contracts/${facts.contractId}#variation-${facts.number}`),
    doc_type: DOC_TYPE.variation,
    subject: subject([
      `${DOC_TYPE.variation} ${facts.number}`,
      facts.contractRef,
      facts.descriptionEl,
      moneyInText(facts.value),
    ]),
    sender_ref: `${facts.contractRef}/${facts.number}`.slice(0, 120),
    letter_date: facts.letterDate,
    category: "Συμβάσεις",
    counterparties: [vendorCounterparty(facts.contractor)],
    amount: round2(facts.value),
    related,
    approvals: approvalsOf(facts.approvals),
    files,
  });
}

/**
 * RULE (eArchive brief): a corrected document is a new item with a new
 * source_ref and a SUPERSEDES relation back at the one it replaces. Version 1
 * supersedes nothing.
 */
function supersedes(previousSourceRef: string, version: number) {
  return version > 1
    ? [{ source_ref: previousSourceRef, relation: "SUPERSEDES" as const }]
    : [];
}

function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export interface AssetDocumentFacts {
  assetId: string;
  tag: string;
  nameEl: string;
  kind: AssetDocumentKindKey;
  /** The nth paper on this asset; part of the source_ref. */
  n: number;
  letterDate: string;
  /** R27: what the asset cost, when the register knows. Zero when it does not. */
  capitalCost: number | null;
  unit: UnitFacts;
  approvals: PersonAction[];
}

/**
 * R28: an asset's paper, filed with eArchive like every other document
 * eCapital produces (ADR-0023). The subject leads with the tag, because the
 * tag is what a technician reads off the label and then types into the
 * registry's search box.
 */
/**
 * M5, ADR-0031 §11: a work order's photograph or the contractor's written
 * report, in the Greek a clerk searching the registry types. eArchive has no
 * «Συντήρηση» category and its list is not ours to extend, so these file
 * under «Συμβάσεις»: the report is a deliverable of the maintenance
 * agreement and the photograph is the evidence the scorecard's penalties
 * rest on.
 */
export const WORK_ORDER_DOC_TYPE = "Έγγραφο εντολής εργασίας συντήρησης";
const WORK_ORDER_DOC_CATEGORY = "Συμβάσεις" as const;

/** `work_order_doc:<work_order_id>:<n>`, the nth paper on this order. Same reasoning as an asset's. */
export function workOrderDocumentSourceRef(workOrderId: string, n: number): string {
  return `work_order_doc:${workOrderId}:${n}`;
}

export interface WorkOrderDocumentFacts {
  workOrderId: string;
  ref: string;
  titleEl: string;
  assetTag: string | null;
  n: number;
  letterDate: string;
  /** What the repair cost so far, when known. Zero when it is not. */
  cost: number | null;
  contractor: ContractorFacts | null;
  unit: UnitFacts;
  approvals: PersonAction[];
}

/**
 * The subject leads with the order's reference — what the technician reads
 * out over the phone — then the asset's tag and the title. The contractor is
 * the counterparty when the order is under an agreement.
 */
export function buildWorkOrderDocumentMeta(
  facts: WorkOrderDocumentFacts,
  files: DmsFile[],
  origin: string,
): DmsMetaBody {
  return checked({
    ...commonFacts(facts.unit),
    source_module: "work_order_document",
    source_ref: workOrderDocumentSourceRef(facts.workOrderId, facts.n),
    source_url: deepLink(origin, `/maintenance/work-orders/${facts.workOrderId}`),
    doc_type: WORK_ORDER_DOC_TYPE,
    subject: subject([WORK_ORDER_DOC_TYPE, facts.ref, facts.assetTag ?? "", facts.titleEl]),
    sender_ref: facts.ref.slice(0, 120),
    letter_date: facts.letterDate,
    category: WORK_ORDER_DOC_CATEGORY,
    counterparties: facts.contractor ? [vendorCounterparty(facts.contractor)] : [],
    amount: round2(facts.cost ?? 0),
    related: [],
    approvals: approvalsOf(facts.approvals),
    files,
  });
}

/**
 * Owner decision 25/11/2026: eCapital sends no e-mail. The engineer sends an
 * RFI from Outlook and files the sent message, or the reply, against it.
 * Either is correspondence on a contract, so it files under «Συμβάσεις» with
 * the contractor as counterparty, the same as a variation.
 */
export const RFI_DOC_TYPE = "Αλληλογραφία αιτήματος διευκρίνισης";

/** `rfi_doc:<rfi_id>:<n>`, the nth paper on this RFI. Same reasoning as an asset's. */
export function rfiDocumentSourceRef(rfiId: string, n: number): string {
  return `rfi_doc:${rfiId}:${n}`;
}

export interface RfiDocumentFacts {
  rfiId: string;
  contractId: string;
  contractRef: string | null;
  number: number;
  questionEl: string;
  recipientName: string | null;
  n: number;
  letterDate: string;
  contractor: ContractorFacts | null;
  unit: UnitFacts;
  approvals: PersonAction[];
}

/**
 * The subject leads with the RFI's number on the contract — «ΑΔ 3» is what
 * a site meeting calls it — then the contract's reference, the recipient
 * and the question, cut to fit.
 */
export function buildRfiDocumentMeta(
  facts: RfiDocumentFacts,
  files: DmsFile[],
  origin: string,
): DmsMetaBody {
  const label = `Αίτημα διευκρίνισης ${facts.number}`;
  return checked({
    ...commonFacts(facts.unit),
    source_module: "rfi_document",
    source_ref: rfiDocumentSourceRef(facts.rfiId, facts.n),
    source_url: deepLink(origin, `/contracts/${facts.contractId}/rfis`),
    doc_type: RFI_DOC_TYPE,
    subject: subject([
      RFI_DOC_TYPE,
      label,
      facts.contractRef ?? "",
      facts.recipientName ?? "",
      facts.questionEl.slice(0, 200),
    ]),
    sender_ref: `${facts.contractRef ?? facts.contractId}/ΑΔ-${facts.number}`.slice(0, 120),
    letter_date: facts.letterDate,
    category: "Συμβάσεις",
    counterparties: facts.contractor ? [vendorCounterparty(facts.contractor)] : [],
    amount: 0,
    related: [],
    approvals: approvalsOf(facts.approvals),
    files,
  });
}

export function buildAssetDocumentMeta(
  facts: AssetDocumentFacts,
  files: DmsFile[],
  origin: string,
): DmsMetaBody {
  const docType = ASSET_DOC_TYPE[facts.kind];
  return checked({
    ...commonFacts(facts.unit),
    source_module: "asset_document",
    source_ref: assetDocumentSourceRef(facts.assetId, facts.n),
    source_url: deepLink(origin, `/assets/${facts.assetId}`),
    doc_type: docType,
    subject: subject([docType, facts.tag, facts.nameEl]),
    sender_ref: facts.tag.slice(0, 120),
    letter_date: facts.letterDate,
    category: ASSET_DOC_CATEGORY[facts.kind],
    counterparties: [],
    amount: round2(facts.capitalCost ?? 0),
    related: [],
    approvals: approvalsOf(facts.approvals),
    files,
  });
}

/**
 * ADR-0035 §4, 0029: the papers of a claim, in the Greek a clerk searching
 * the registry types. Not i18n keys, for the reason ADR-0023 §«Strings»
 * gives. A lawyer's letter files under «Νομικά», which is where the
 * Organisation's legal service looks; the letter that made the claim and the
 * reply to it are contract correspondence and file under «Συμβάσεις».
 */
export const CLAIM_DOC_TYPE = {
  CLAIM_LETTER: "Επιστολή αξίωσης",
  CLAIM_REPLY: "Απάντηση σε αξίωση",
  CLAIM_LEGAL_LETTER: "Επιστολή δικηγόρου για αξίωση",
} as const;

export type ClaimDocumentKindKey = keyof typeof CLAIM_DOC_TYPE;

const CLAIM_DOC_CATEGORY: Record<ClaimDocumentKindKey, "Συμβάσεις" | "Νομικά"> = {
  CLAIM_LETTER: "Συμβάσεις",
  CLAIM_REPLY: "Συμβάσεις",
  CLAIM_LEGAL_LETTER: "Νομικά",
};

/** `claim_doc:<claim_id>:<n>`, the nth paper on this claim. Same reasoning as an asset's. */
export function claimDocumentSourceRef(claimId: string, n: number): string {
  return `claim_doc:${claimId}:${n}`;
}

export interface ClaimDocumentFacts {
  claimId: string;
  contractId: string;
  contractRef: string;
  direction: "BY_CONTRACTOR" | "BY_ORGANISATION";
  titleEl: string;
  amount: number;
  notifiedAt: string | null;
  kind: ClaimDocumentKindKey;
  n: number;
  /** The day the paper is filed, in Nicosia: the letter date when nothing better is known. */
  filedOn: string;
  unit: UnitFacts;
  contractor: ContractorFacts;
  approvals: PersonAction[];
}

/**
 * Who wrote the paper. A claim by the contractor arrives as their letter and
 * their lawyer's, and the reply is ours; a claim by the Organisation is the
 * other way round. What came from the contractor is filed as incoming, with
 * the contractor as the sender; what we wrote is internal, from Technical
 * Services, like every other paper eCapital files.
 */
export function claimPaperIsIncoming(
  direction: ClaimDocumentFacts["direction"],
  kind: ClaimDocumentKindKey,
): boolean {
  return (direction === "BY_CONTRACTOR") !== (kind === "CLAIM_REPLY");
}

/**
 * The subject leads with the kind of paper and the contract's reference, then
 * the claim's own title and amount. The letter that made the claim is dated
 * the day it was notified, when that is known; any other paper the day it is
 * filed. Every paper points back at the award, as a variation does, so the
 * claim and the contract are one story in the registry.
 */
export function buildClaimDocumentMeta(
  facts: ClaimDocumentFacts,
  files: DmsFile[],
  origin: string,
): DmsMetaBody {
  const docType = CLAIM_DOC_TYPE[facts.kind];
  const incoming = claimPaperIsIncoming(facts.direction, facts.kind);
  const letterDate =
    facts.kind === "CLAIM_LETTER" && facts.notifiedAt ? facts.notifiedAt : facts.filedOn;
  return checked({
    ...commonFacts(facts.unit),
    ...(incoming
      ? { direction: "IN" as const, sender_name: facts.contractor.name.slice(0, 200) }
      : {}),
    source_module: "claim_document",
    source_ref: claimDocumentSourceRef(facts.claimId, facts.n),
    source_url: deepLink(origin, `/contracts/${facts.contractId}/claims`),
    doc_type: docType,
    subject: subject([docType, facts.contractRef, facts.titleEl, moneyInText(facts.amount)]),
    sender_ref: `${facts.contractRef}/claim`.slice(0, 120),
    letter_date: letterDate,
    ...(facts.notifiedAt ? { event_date: facts.notifiedAt } : {}),
    category: CLAIM_DOC_CATEGORY[facts.kind],
    counterparties: [vendorCounterparty(facts.contractor)],
    amount: round2(facts.amount),
    related: [{ source_ref: `award:${facts.contractId}`, relation: "RELATED" as const }],
    approvals: approvalsOf(facts.approvals),
    files,
  });
}
