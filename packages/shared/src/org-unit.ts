import { z } from "zod";

// CAPEX-01 §4: the first organisational level is the org unit, never
// "hospital". Eight hospitals plus two services plus one central unit plus
// Community Nursing, twelve units in all (CAPEX-03 §3; CAPEX-01's "nine
// hospitals" counted Troodos and Kyperounta twice — they are one hospital,
// confirmed by the owner on 18/09/2026 — and the third service, Υπηρεσία
// Ασθενοφόρων, left ΟΚΥπΥ on 19/09/2026, ADR-0024). CAPEX-01 §4 lists only
// HOSPITAL and SERVICE because the Capex Plan sheet has no HQ rows; CENTRAL
// is Central Administration itself, added by owner decision on 19/09/2026 so
// it can own its own projects (IT, HQ works) and be filtered on like any
// other unit. «Κοινοτική Νοσηλευτική Υπηρεσία» (Community Nursing Service,
// `community-nursing`, type SERVICE) was added by owner decision on
// 20/09/2026 — see ADR-0024's addendum — correcting yesterday's errata,
// which had it filing under HQ with no unit of its own.
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
  // ADR-0024: no unit carries AMBULANCE any more — the Ambulance Service left
  // ΟΚΥπΥ on 19/09/2026. The value stays on the enum because dropping one
  // from a PostgreSQL enum means recreating the type and every column that
  // uses it, and because the audit log's before-images still name it.
  // Nothing lists a directorate that has no units in it.
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
  // ADR-0019, as amended by ADR-0024 (owner decision, 19/09/2026): the code
  // eFinance, eArchive and SAP Funds Management all key this place by. It is
  // eArchive's site abbreviation now — NGH, LAR, PAF, LGH, KYP, NAM, POL,
  // FAM, MHS, PHC, HQ, CNS — and therefore the same string as `code` above.
  // The column is kept, rather than folded into `code`, because it is what a
  // join across the three systems names, here and in eFinance's own notes.
  // Nullable because a unit opened here before finance gives it a code has
  // none. Send the code, never the name.
  entityCode: z.string().nullable().default(null),
  // ADR-0022's addendum (owner decision, 20/09/2026): eFinance keeps its own
  // entity keys permanently — they are foreign keys across twelve of its own
  // tables and SAP — rather than aligning with eArchive's abbreviation, so
  // eCapital carries both. This is eFinance's own code, differing from
  // `entityCode` on six of the twelve units: PAF/`PAP`, KYP/`TRD`, NAM/`ARC`,
  // POL/`CHR`, MHS/`MH`, PHC/`HC`; unchanged on the rest (NGH, LAR, LGH, FAM,
  // HQ, CNS). Nullable for the same reason as `entityCode`. See ADR-0022's
  // and ADR-0024's addenda and INTEGRATION-eFinance-eMAP-eCapital.md §2.
  efinanceCode: z.string().nullable().default(null),
  timezone: z.literal("Europe/Nicosia"),
});
export type OrgUnit = z.infer<typeof OrgUnit>;
