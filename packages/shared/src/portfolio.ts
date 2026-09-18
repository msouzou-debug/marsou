import { z } from "zod";
import { OrgUnit } from "./org-unit";

// S01 Χαρτοφυλάκιο — UI instructions §5. KPI strip: four ledgers plus the
// comparator every tile shows ("% έτους που έχει παρέλθει").
// RULE (CAPEX-01 §7): a ledger the system does not know yet is null, never
// zero, and the tile shows «—». Committed, spent and forecast stay null until
// the SAP ingestion lands (M2, R14, R16), so the three of them are nullable
// here; `approved` is known from the day a project is opened.
export const PortfolioKpis = z.object({
  approved: z.number(),
  committed: z.number().nullable(),
  spent: z.number().nullable(),
  forecast: z.number().nullable(),
  yearElapsedPct: z.number(),
});
export type PortfolioKpis = z.infer<typeof PortfolioKpis>;

// UI instructions §5 S01: unit table, one row per org unit. Sparkline is a
// 96×24 SVG in the UI, fed by 12 monthly cumulative points.
export const UnitRow = z.object({
  orgUnit: OrgUnit,
  projectCount: z.number().int().nonnegative(),
  approved: z.number(),
  spent: z.number(),
  sparkline: z.object({
    plan: z.array(z.number()).length(12),
    spend: z.array(z.number()).length(12),
  }),
  rag: z.object({
    green: z.number().int().nonnegative(),
    amber: z.number().int().nonnegative(),
    red: z.number().int().nonnegative(),
  }),
});
export type UnitRow = z.infer<typeof UnitRow>;

// UI instructions §5 S01: "Χρειάζονται προσοχή" — max eight, one sentence
// each, bilingual (the interface never machine-translates user content, so
// the sentence itself is authored in both languages, not translated live).
export const Exception = z.object({
  id: z.string(),
  projectId: z.string(),
  orgUnitId: z.string(),
  sentenceEl: z.string(),
  sentenceEn: z.string(),
  severity: z.enum(["amber", "red"]),
  href: z.string(),
});
export type Exception = z.infer<typeof Exception>;

export const PortfolioResponse = z.object({
  kpis: PortfolioKpis,
  units: z.array(UnitRow),
  exceptions: z.array(Exception).max(8),
  asOf: z.string(), // ISO datetime
});
export type PortfolioResponse = z.infer<typeof PortfolioResponse>;
