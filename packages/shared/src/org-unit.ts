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
// other unit. «Κοινοτική Νοσηλευτική» (Community Nursing, `community-nursing`,
// type SERVICE) was added by owner decision on 20/09/2026 — see ADR-0024's
// addendum — correcting yesterday's errata, which had it filing under HQ with
// no unit of its own. Named exactly as eArchive's folder Φ. ΤΥ.12 (owner
// decision, 21/09/2026; migration 0019).
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
  // ADR-0034 (owner decision, 19/10/2026): one code per place in every tool,
  // eFinance's — NGH, LAR, PAP, LGH, TRD, ARC, CHR, FAM, MH, HC, HQ, CNS —
  // and therefore the same string as `code` above. The column is kept,
  // rather than folded into `code`, because it is what a join across the
  // three systems names, here and in eFinance's own notes. Nullable because
  // a unit opened here before finance gives it a code has none. Send the
  // code, never the name.
  entityCode: z.string().nullable().default(null),
  // eFinance's own entity code, what the eFinance client sends on a contract
  // push and a budget-position read. Since ADR-0034 it equals `entityCode`
  // on every unit; it stays its own field so a future divergence is data and
  // not code (ADR-0022's addendum first introduced it, when the two differed
  // on six units). Nullable for the same reason as `entityCode`. See
  // INTEGRATION-eFinance-eMAP-eCapital.md §2.
  efinanceCode: z.string().nullable().default(null),
  timezone: z.literal("Europe/Nicosia"),
});
export type OrgUnit = z.infer<typeof OrgUnit>;
