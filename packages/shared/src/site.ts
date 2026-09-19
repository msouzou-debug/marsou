import { z } from "zod";

// ------------------------------------------------------------ M1 (R09, R12)
// CAPEX-01 §4 rfi, site_instruction, defect. Glossary (CAPEX-02 §7):
// Αίτημα διευκρίνισης, Οδηγία εργοταξίου, Έλλειψη (plural Ελλείψεις),
// Παραλαβή έργου (Προσωρινή / Οριστική).

export const RfiStatus = z.enum(["OPEN", "ANSWERED", "CLOSED"]);
export type RfiStatus = z.infer<typeof RfiStatus>;

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
});
export type Rfi = z.infer<typeof Rfi>;

export const RfiCreate = z.object({
  questionEl: z.string().min(1),
  // Default 7 days; a contract may carry its own in the SLA table later (M5).
  slaDays: z.number().int().min(1).max(60).default(7),
});
export type RfiCreate = z.infer<typeof RfiCreate>;

export const RfiAnswer = z.object({ answerEl: z.string().min(1) });
export type RfiAnswer = z.infer<typeof RfiAnswer>;

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

export const SiteInstructionCreate = SiteInstruction.pick({ textEl: true, costImpactFlag: true });
export type SiteInstructionCreate = z.infer<typeof SiteInstructionCreate>;

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
});
export type DefectCreate = z.infer<typeof DefectCreate>;

export const DefectUpdate = Defect.pick({
  descriptionEl: true,
  estimatedCost: true,
  riskBand: true,
  funded: true,
  targetProjectId: true,
  status: true,
}).partial();
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
