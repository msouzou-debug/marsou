import type { OrgUnit } from "@ecapital/shared";
import { orgUnits } from "@/mocks/org-units";

// RULE: the first organisational level is the org unit — hospitals plus the
// three services — and its label is «Μονάδα», never «Νοσοκομείο» (UI
// instructions §2; CAPEX-02 §7). Hospital names appear only as values.
//
// The shell falls back to the same eleven units the data layer seeds from
// CAPEX-03 §3 (ADR-0005). CAPEX-01 counts nine hospitals; the migration
// source lists eight plus Troodos. Nothing is invented here to close that
// gap — the owner decides which hospital, if any, is missing.
export const FALLBACK_ORG_UNITS: OrgUnit[] = orgUnits;
