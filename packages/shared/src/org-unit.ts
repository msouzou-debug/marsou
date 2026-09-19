import { z } from "zod";

// CAPEX-01 §4: the first organisational level is the org unit, never
// "hospital". Eight hospitals plus three services plus one central unit,
// twelve units in all (CAPEX-03 §3; CAPEX-01's "nine hospitals" counted
// Troodos and Kyperounta twice — they are one hospital, confirmed by the
// owner on 18/09/2026). CAPEX-01 §4 lists only HOSPITAL and SERVICE because
// the Capex Plan sheet has no HQ rows; CENTRAL is Central Administration
// itself, added by owner decision on 19/09/2026 so it can own its own
// projects (IT, HQ works) and be filtered on like any other unit.
export const OrgUnitType = z.enum(["HOSPITAL", "SERVICE", "CENTRAL"]);
export type OrgUnitType = z.infer<typeof OrgUnitType>;

// CAPEX-03 §3: directorate is stored, never derived from the unit.
// KENTRIKI_DIOIKISI (Central Administration) was added by owner decision on
// 19/09/2026 alongside the CENTRAL org-unit type, for the same reason: it has
// no row in the Capex Plan sheet, so it is not one of the six directorates
// that section counts, but it is a real directorate the HQ unit sits under.
export const Directorate = z.enum([
  "LEMESOU_PAFOU",
  "LEFKOSIAS",
  "LARNAKAS_AMMOCHOSTOU",
  "DYPSY",
  "PFY",
  "AMBULANCE",
  "KENTRIKI_DIOIKISI",
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
  // Nullable because the two registers are not the same list: eFinance's CNS
  // has no eCapital unit, and a unit opened here before finance gives it a
  // code has none. HQ used to be in the same boat; owner decision 19/09/2026
  // gave it a unit (`hq`, code `HQ`), so its entityCode is `HQ`, not null.
  // Send the code, never the name.
  entityCode: z.string().nullable().default(null),
  timezone: z.literal("Europe/Nicosia"),
});
export type OrgUnit = z.infer<typeof OrgUnit>;
