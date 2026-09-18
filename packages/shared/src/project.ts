import { z } from "zod";

// CAPEX-01 §4: project category. The migration mapping (CAPEX-03 col A)
// only ever produces CAPITAL_WORKS for the imported rows, but the target
// data model carries the full set so the system can classify new projects
// created after go-live.
export const ProjectCategory = z.enum([
  "NEW_BUILD",
  "RENOVATION",
  "SMALL_WORKS",
  "EQUIPMENT",
  "MAINTENANCE_CAPITAL",
  "IT",
]);
export type ProjectCategory = z.infer<typeof ProjectCategory>;

// Reconciliation note (CAPEX-01 §4 vs CAPEX-03 §4): CAPEX-01 lists eight
// phases (IDEA…CLOSED). CAPEX-03 §4 maps the three source statuses onto
// what it calls "the target model['s] nine" phases, without listing a
// ninth. PREPARATION is the missing one: CAPEX-03 §4 says "Preparation
// covers everything from idea to signed contract", which is exactly the
// gap between IDEA and APPROVED in the CAPEX-01 list, and is the phase
// that holds 70 of the 113 migrated rows. Inserted here between IDEA and
// APPROVED to reconcile the two documents. Flagged in the build summary
// rather than guessed silently.
export const ProjectPhase = z.enum([
  "IDEA",
  "PREPARATION",
  "APPROVED",
  "TENDERED",
  "AWARDED",
  "IN_PROGRESS",
  "PRACTICAL_COMPLETION",
  "DEFECTS_LIABILITY",
  "CLOSED",
]);
export type ProjectPhase = z.infer<typeof ProjectPhase>;

export const FundingSource = z.enum(["STATE_BUDGET", "EU", "DONATION", "OWN"]);
export type FundingSource = z.infer<typeof FundingSource>;

// CAPEX-01 §7: red/amber/green health of a project, set from the four
// ledgers below. GREEN|AMBER|RED per the UI instructions §1 token set.
export const Rag = z.enum(["GREEN", "AMBER", "RED"]);
export type Rag = z.infer<typeof Rag>;

// CAPEX-01 §4 `project` (the subset the portfolio and cost screens need;
// business case, milestones, risks and issues are separate tables not
// built here).
export const Project = z.object({
  id: z.string(),
  code: z.string(),
  orgUnitId: z.string(),
  titleEl: z.string(),
  category: ProjectCategory,
  phase: ProjectPhase,
  approvedBudget: z.number().nonnegative(),
  fundingSource: FundingSource,
  plannedStart: z.string(), // ISO date, e.g. 2026-09-01
  plannedFinish: z.string(),
  rag: Rag,
  ragReason: z.string(),
  sapWbs: z.string().nullable(),
  tenderReference: z.string().nullable(),
});
export type Project = z.infer<typeof Project>;

// CAPEX-01 §7: the four ledgers, always kept separate — never collapsed
// into one "spend" number. Figures in EUR.
export const ProjectLedgers = z.object({
  approved: z.number(),
  committed: z.number(),
  spent: z.number(),
  forecast: z.number(),
});
export type ProjectLedgers = z.infer<typeof ProjectLedgers>;

export const ProjectSummary = Project.extend({
  ledgers: ProjectLedgers,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;
