import { z } from "zod";

// CAPEX-01 §4: the first organisational level is the org unit, never
// "hospital". Three of the twelve units are services.
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
  timezone: z.literal("Europe/Nicosia"),
});
export type OrgUnit = z.infer<typeof OrgUnit>;
