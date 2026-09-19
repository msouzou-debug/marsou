import { z } from "zod";

// CAPEX-01 §4: the first organisational level is the org unit, never
// "hospital". Eight hospitals plus three services, eleven units in all
// (CAPEX-03 §3; CAPEX-01's "nine hospitals" counted Troodos and Kyperounta
// twice — they are one hospital, confirmed by the owner on 18/09/2026).
export const OrgUnitType = z.enum(["HOSPITAL", "SERVICE"]);
export type OrgUnitType = z.infer<typeof OrgUnitType>;

// CAPEX-03 §3: directorate is stored, never derived from the unit.
export const Directorate = z.enum([
  "LEMESOU_PAFOU",
  "LEFKOSIAS",
  "LARNAKAS_AMMOCHOSTOU",
  "DYPSY",
  "PFY",
  "AMBULANCE",
]);
export type Directorate = z.infer<typeof Directorate>;

export const OrgUnit = z.object({
  id: z.string(),
  code: z.string(),
  nameEl: z.string(),
  nameEn: z.string(),
  type: OrgUnitType,
  directorate: Directorate,
  costCentre: z.string().nullable(),
  // ADR-0019: the eFinance entity code for the same unit — NGH, LAR, ARC …
  // Nullable because the two registers are not the same list: eFinance has
  // HQ and CNS, which have no eCapital unit yet, and a unit opened here
  // before finance gives it a code has none. Send the code, never the name.
  entityCode: z.string().nullable().default(null),
  timezone: z.literal("Europe/Nicosia"),
});
export type OrgUnit = z.infer<typeof OrgUnit>;
