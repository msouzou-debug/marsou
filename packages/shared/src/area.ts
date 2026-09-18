import { z } from "zod";

// CAPEX-01 §4 — the spine below the org unit: building → floor → area.
// Nothing here describes a person. `beds` counts the beds a room holds and
// `patientRiskGroup` is the ICRA 2.0 Table 2 band of the room itself.

export const AreaType = z.enum([
  "THEATRE",
  "ICU",
  "WARD",
  "OPD",
  "LAB",
  "PLANT",
  "OFFICE",
  "OTHER",
]);
export type AreaType = z.infer<typeof AreaType>;

// ICRA 2.0 Table 2.
export const PatientRiskGroup = z.enum(["LOW", "MEDIUM", "HIGH", "HIGHEST"]);
export type PatientRiskGroup = z.infer<typeof PatientRiskGroup>;

export const Area = z.object({
  id: z.string(),
  floorId: z.string(),
  code: z.string(),
  nameEl: z.string(),
  areaType: AreaType,
  patientRiskGroup: PatientRiskGroup,
  costCentre: z.string().nullable(),
  beds: z.number().int().nullable(),
});
export type Area = z.infer<typeof Area>;

export const Floor = z.object({
  id: z.string(),
  buildingId: z.string(),
  code: z.string(),
  nameEl: z.string(),
  level: z.number().int().nullable(),
  areas: z.array(Area),
});
export type Floor = z.infer<typeof Floor>;

export const Building = z.object({
  id: z.string(),
  orgUnitId: z.string(),
  code: z.string(),
  nameEl: z.string(),
  grossAreaM2: z.number().nullable(),
  yearBuilt: z.number().int().nullable(),
  storeys: z.number().int().nullable(),
  floors: z.array(Floor),
});
export type Building = z.infer<typeof Building>;

// GET /org-units/:id/areas
export const AreaTree = z.object({
  orgUnitId: z.string(),
  buildings: z.array(Building),
});
export type AreaTree = z.infer<typeof AreaTree>;

// POST /org-units/:id/areas — what the caller sends. `orgUnitId` is not in
// the body: it is the path, and the row policy is what decides whether the
// caller may write there.
export const AreaCreate = z.object({
  floorId: z.string().uuid(),
  code: z.string().min(1).max(32),
  nameEl: z.string().min(1).max(200),
  areaType: AreaType,
  patientRiskGroup: PatientRiskGroup,
  costCentre: z.string().max(32).nullish(),
  beds: z.number().int().min(0).nullish(),
});
export type AreaCreate = z.infer<typeof AreaCreate>;
