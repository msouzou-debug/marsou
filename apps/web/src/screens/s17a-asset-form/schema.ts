// S17a — R26–R30, R45
//
// Client-side validation for the create/edit form (`AssetForm.tsx`). Built on
// `packages/shared`'s `AssetWrite`, not instead of it — the API re-validates
// the same body with the same zod schema (`zodResolver.ts`'s own note on
// `s02a-project-form/schema.ts` applies here verbatim). What this file adds
// is the message a person actually sees, and the stricter "must be filled
// in" rule a bare `nullable()` field does not itself carry.
//
// Owner steer (20/09/2026, lean scope): this form edits the fields the M4
// build brief actually names — identity, make/model/serial, dates, source
// project/contract, money, life, criticality, system and serves-areas. It
// does not expose `costCentre`, `sapAssetNo` or `status`: the contract
// leaves all three optional and the brief's own field list never mentions
// them, so they are left for the API's own defaults rather than guessed
// into a form the brief did not ask for. Flagged in the hand-back summary.
//
// UAT 25/11/2026: the limits are the database's (0017, `ASSET_LIMITS` in
// the contract) — a name of 2 to 200 characters, a life of 1 to 120 years,
// a replacement year from 1900 to 2200, no negative money — each with its
// message under its own field, so the API's refusal is never the first a
// person hears of them. The dates run in order (`assetDateIssues`, the same
// function the API asks): commissioning not before installation, the
// warranty not before either, neither installation nor commissioning after
// today in Nicosia, and no replacement before the year of installation.
import { z } from "zod";
import { ASSET_LIMITS, AssetClass, Criticality, PermitSystem, assetDateIssues, nicosiaToday } from "@ecapital/shared";

export interface AssetFormValues {
  nameEl: string;
  assetClass: AssetClass;
  areaId: string | null;
  parentAssetId: string | null;
  manufacturer: string | null;
  model: string | null;
  serialNo: string | null;
  installedDate: string | null;
  commissionedDate: string | null;
  sourceProjectId: string | null;
  sourceContractId: string | null;
  capitalCost: number | null;
  warrantyEnd: string | null;
  expectedLifeYears: number | null;
  replacementYear: number | null;
  replacementCostEst: number | null;
  criticality: number;
  system: PermitSystem | null;
  servesAreaIds: string[];
}

export interface AssetCreateFormValues extends AssetFormValues {
  orgUnitId: string;
}

const nullableString = z.string().nullable();
const nullableDate = z.iso.date({ message: "forms.invalidDate" }).nullable();
const nullableMoney = z.number().min(0, "screens.s17a.errors.costNonNegative").nullable();
const LIFE = "screens.s17a.errors.expectedLifeRange";
const YEAR = "screens.s17a.errors.replacementYearRange";
const NAME = "screens.s17a.errors.nameLength";

const sharedFields = {
  nameEl: z.string().trim().min(1, "forms.required").min(ASSET_LIMITS.nameMin, NAME).max(ASSET_LIMITS.nameMax, NAME),
  assetClass: AssetClass,
  areaId: nullableString,
  parentAssetId: nullableString,
  manufacturer: nullableString,
  model: nullableString,
  serialNo: nullableString,
  installedDate: nullableDate,
  commissionedDate: nullableDate,
  sourceProjectId: nullableString,
  sourceContractId: nullableString,
  capitalCost: nullableMoney,
  warrantyEnd: nullableDate,
  expectedLifeYears: z.number().int(LIFE).min(ASSET_LIMITS.lifeMin, LIFE).max(ASSET_LIMITS.lifeMax, LIFE).nullable(),
  replacementYear: z.number().int(YEAR).min(ASSET_LIMITS.yearMin, YEAR).max(ASSET_LIMITS.yearMax, YEAR).nullable(),
  replacementCostEst: nullableMoney,
  criticality: Criticality,
  system: PermitSystem.nullable(),
  servesAreaIds: z.array(z.string()),
};

/** The date rules, each message under the field it is about. */
function datesInOrder(values: Parameters<typeof assetDateIssues>[0], ctx: z.RefinementCtx): void {
  for (const issue of assetDateIssues(values, nicosiaToday())) {
    ctx.addIssue({ code: "custom", path: [issue.field], message: `screens.s17a.errors.${issue.rule}` });
  }
}

/** S17a Νέο πάγιο — `POST /assets`. */
export const AssetCreateFormSchema = z
  .object({
    orgUnitId: z.string().min(1, "forms.required"),
    ...sharedFields,
  })
  .superRefine(datesInOrder);

/** S17a Επεξεργασία — `PATCH /assets/:id`. No `orgUnitId`: the register is scoped by unit at creation, the same way a project's unit is fixed (ADR-0014's precedent). */
export const AssetEditFormSchema = z.object({ ...sharedFields }).superRefine(datesInOrder);
