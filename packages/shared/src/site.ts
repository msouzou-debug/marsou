import { z } from "zod";
import { CalendarDate, PastOrTodayDate } from "./calendar-date";

// ------------------------------------------------------------ M1 (R09, R12)
// CAPEX-01 §4 rfi, site_instruction, defect. Glossary (CAPEX-02 §7):
// Αίτημα διευκρίνισης, Οδηγία εργοταξίου, Έλλειψη (plural Ελλείψεις),
// Παραλαβή έργου (Προσωρινή / Οριστική).

export const RfiStatus = z.enum(["OPEN", "ANSWERED", "CLOSED"]);
export type RfiStatus = z.infer<typeof RfiStatus>;

// The SLA band of an RFI, the same four the SlaChip draws
// (apps/web/src/components/sla-chip/SlaChip.tsx `slaState`): GREEN above half
// the SLA remaining, AMBER from half down to a tenth, RED below a tenth, and
// BREACHED once the due moment has passed. The API computes it and sends it
// with every RFI so a list can be sorted and counted on the server; the chip
// keeps computing its own so it can tick without a round trip. Uppercase
// here, lowercase there, because this is data and that is a CSS class.
export const SlaState = z.enum(["GREEN", "AMBER", "RED", "BREACHED"]);
export type SlaState = z.infer<typeof SlaState>;

// An RFI carries an SLA (R09). slaDueAt is set by the API from raisedAt +
// slaDays; the SlaChip reads slaDueAt and slaHours. Breach is a state, not a
// block (CAPEX-01 §1: warn-and-flag).
export const Rfi = z.object({
  id: z.string(),
  contractId: z.string(),
  orgUnitId: z.string(),
  number: z.number().int(), // per contract, allocated by the API
  questionEl: z.string(),
  answerEl: z.string().nullable(),
  raisedById: z.string(),
  raisedByName: z.string(),
  raisedAt: z.string(),
  answeredById: z.string().nullable(),
  answeredByName: z.string().nullable(),
  answeredAt: z.string().nullable(),
  slaDueAt: z.string(),
  slaHours: z.number().int().positive(),
  status: RfiStatus,
  // Computed by the API on the way out, never stored: a band that was stored
  // would be wrong the minute after it was written. RULE (R09, R33): the
  // clock stops when the question is answered, so an RFI answered inside its
  // SLA keeps the band it was answered in instead of drifting to BREACHED
  // while it waits to be closed.
  slaState: SlaState,
  // Owner decision 25/11/2026: eCapital sends no e-mail. The engineer sends
  // the RFI from Outlook and records here who it went to, the address used
  // and the day it left (yyyy-mm-dd). Null on an RFI raised before the
  // fields existed; the name is required on every new one.
  recipientName: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  sentOn: z.string().nullable(),
  // Owner UAT 25/11/2026 (migration 0032). `answeredOn` is the day the
  // answer arrived (yyyy-mm-dd); for an answer recorded before 0032 it is
  // the day of `answeredAt`. An RFI can be closed with or without an
  // answer: who closed it, when, and the note (required when there is no
  // answer). `closedAt` is null only on an RFI that is not closed;
  // `closedById` is also null on one closed before 0032. Optional for the
  // fixture reason `ContractDetail` gives; the API always sends them.
  answeredOn: z.string().nullable().optional(),
  closedById: z.string().nullable().optional(),
  closedByName: z.string().nullable().optional(),
  closedAt: z.string().nullable().optional(),
  closingNote: z.string().nullable().optional(),
});
export type Rfi = z.infer<typeof Rfi>;

export const RFI_RECIPIENT_NAME_MAX = 200;
export const RFI_RECIPIENT_EMAIL_MAX = 254;

const RecipientName = z.string().trim().min(1).max(RFI_RECIPIENT_NAME_MAX);
const RecipientEmail = z.string().trim().max(RFI_RECIPIENT_EMAIL_MAX).email();

export const RfiCreate = z.object({
  questionEl: z.string().min(1),
  // Default 7 days; a contract may carry its own in the SLA table later (M5).
  slaDays: z.number().int().min(1).max(60).default(7),
  recipientName: RecipientName,
  recipientEmail: RecipientEmail.nullable().optional(),
  // RULE (owner, UAT 25/11/2026): not after today, here; not before the day
  // the RFI was raised, in the service — on a new RFI that day is today.
  sentOn: PastOrTodayDate.nullable().optional(),
});
export type RfiCreate = z.infer<typeof RfiCreate>;

// UAT 25/11/2026: an RFI can be corrected until it is closed — the question,
// the due date, and (owner decision 25/11/2026) who it went to and when it
// was sent. Who raised it and when, the answer and who gave it are not here:
// the first two are facts of record, the answer has its own route.
// RULE (owner): the due date and the day it was sent are not before the day
// the RFI was raised; the service checks that against the row, because only
// the row knows the day. The address and the sent day can be cleared (null);
// a recipient, once named, is corrected rather than removed.
export const RfiUpdate = z
  .object({
    questionEl: z.string().min(1),
    dueDate: CalendarDate,
    recipientName: RecipientName,
    recipientEmail: RecipientEmail.nullable(),
    sentOn: PastOrTodayDate.nullable(),
  })
  .partial();
export type RfiUpdate = z.infer<typeof RfiUpdate>;

// The evidence filed against an RFI (owner decision 25/11/2026): the sent
// e-mail as .msg, .eml or .pdf, or the reply received. Each is a `document`
// row queued for eArchive (ADR-0023); `protocolNumber` arrives once eArchive
// has answered. The bytes are read through `GET /documents/:id/content`.
export const RfiDocument = z.object({
  id: z.string(),
  titleEl: z.string(),
  filename: z.string(),
  mime: z.string(),
  size: z.number().int(),
  protocolNumber: z.string().nullable(),
  uploadedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type RfiDocument = z.infer<typeof RfiDocument>;

// RULE (owner, UAT 25/11/2026): the answer and the day it arrived. Not
// after today, here; not before the day the RFI was raised, in the service.
// Left out, it is today.
export const RfiAnswer = z.object({
  answerEl: z.string().trim().min(1),
  answeredOn: PastOrTodayDate.optional(),
});
export type RfiAnswer = z.infer<typeof RfiAnswer>;

export const RFI_CLOSING_NOTE_MAX = 4000;

// RULE (owner, UAT 25/11/2026): an RFI closes with or without an answer.
// The note is optional on an answered RFI and required on an unanswered one
// (the service says errors.rfiCloseNoteNeeded). An empty body is a close
// with no note.
export const RfiClose = z.object({
  closingNote: z.string().trim().max(RFI_CLOSING_NOTE_MAX).optional(),
});
export type RfiClose = z.infer<typeof RfiClose>;

export const SiteInstruction = z.object({
  id: z.string(),
  contractId: z.string(),
  orgUnitId: z.string(),
  number: z.number().int(),
  textEl: z.string(),
  issuedById: z.string(),
  issuedByName: z.string(),
  issuedAt: z.string(),
  // RULE (CAPEX-01 §4): an instruction with cost impact must end up as a
  // variation; the flag is what the variations list cross-checks.
  costImpactFlag: z.boolean(),
  variationId: z.string().nullable(),
});
export type SiteInstruction = z.infer<typeof SiteInstruction>;

// `issuedOn` is the day the instruction was given on site, which can be
// before the day somebody typed it in; omitted, it is today. RULE (owner, UAT
// 25/11/2026): a day that has already happened, so never after today.
export const SiteInstructionCreate = SiteInstruction.pick({ textEl: true, costImpactFlag: true }).extend({
  issuedOn: PastOrTodayDate.optional(),
});
export type SiteInstructionCreate = z.infer<typeof SiteInstructionCreate>;

// UAT 25/11/2026: an instruction can be corrected until it has been turned
// into a variation; after that the variation is the record of what it cost.
export const SiteInstructionUpdate = z
  .object({
    textEl: z.string().min(1),
    costImpactFlag: z.boolean(),
    issuedOn: PastOrTodayDate,
  })
  .partial();
export type SiteInstructionUpdate = z.infer<typeof SiteInstructionUpdate>;

export const DefectSource = z.enum(["HANDOVER", "INSPECTION", "WORK_ORDER", "CONDITION_SURVEY"]);
export type DefectSource = z.infer<typeof DefectSource>;

// NHS ERIC bands (CAPEX-01 §2): the objective input to next year's programme.
export const RiskBand = z.enum(["HIGH", "SIGNIFICANT", "MODERATE", "LOW"]);
export type RiskBand = z.infer<typeof RiskBand>;

export const DefectStatus = z.enum(["OPEN", "IN_PROGRESS", "CLOSED"]);
export type DefectStatus = z.infer<typeof DefectStatus>;

export const Defect = z.object({
  id: z.string(),
  orgUnitId: z.string(),
  source: DefectSource,
  contractId: z.string().nullable(),
  projectId: z.string().nullable(),
  areaId: z.string().nullable(),
  assetId: z.string().nullable(), // M4
  descriptionEl: z.string(),
  photoIds: z.array(z.string()), // M8; empty until then
  estimatedCost: z.number().nonnegative().nullable(),
  riskBand: RiskBand,
  funded: z.boolean(),
  targetProjectId: z.string().nullable(),
  status: DefectStatus,
  raisedById: z.string(),
  raisedByName: z.string(),
  raisedAt: z.string(),
  // RULE (R12): a handover defect must close inside the defects liability
  // period; dueDate = contract completion + defectsLiabilityMonths.
  dueDate: z.string().nullable(),
  closedAt: z.string().nullable(),
  closedById: z.string().nullable(),
  closedByName: z.string().nullable(),
});
export type Defect = z.infer<typeof Defect>;

export const DefectCreate = Defect.pick({
  source: true,
  areaId: true,
  descriptionEl: true,
  estimatedCost: true,
  riskBand: true,
}).extend({
  contractId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  // The day the defect was found, which can be before the day it was typed
  // in; omitted, it is today. RULE (owner, UAT 25/11/2026): never after today.
  raisedOn: PastOrTodayDate.optional(),
});
export type DefectCreate = z.infer<typeof DefectCreate>;

export const DefectUpdate = Defect.pick({
  descriptionEl: true,
  estimatedCost: true,
  riskBand: true,
  funded: true,
  targetProjectId: true,
  status: true,
})
  .extend({ raisedOn: PastOrTodayDate })
  .partial();
export type DefectUpdate = z.infer<typeof DefectUpdate>;

// Backlog summary (R35 later; the shape is fixed now so S21 can be built on it).
export const DefectBacklogRow = z.object({
  orgUnitId: z.string(),
  riskBand: RiskBand,
  count: z.number().int(),
  estimatedCost: z.number(),
  funded: z.number(),
  unfunded: z.number(),
});
export type DefectBacklogRow = z.infer<typeof DefectBacklogRow>;
