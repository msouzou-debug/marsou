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
import { z } from "zod";
import { AssetClass, Criticality, PermitSystem } from "@ecapital/shared";

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
const nullableYear = z.number().int().nullable();
const nullableMoney = z.number().nullable();

const sharedFields = {
  nameEl: z.string().trim().min(1, "forms.required"),
  assetClass: AssetClass,
  areaId: nullableString,
  parentAssetId: nullableString,
  manufacturer: nullableString,
  model: nullableString,
  serialNo: nullableString,
  installedDate: nullableString,
  commissionedDate: nullableString,
  sourceProjectId: nullableString,
  sourceContractId: nullableString,
  capitalCost: nullableMoney,
  warrantyEnd: nullableString,
  expectedLifeYears: nullableYear,
  replacementYear: nullableYear,
  replacementCostEst: nullableMoney,
  criticality: Criticality,
  system: PermitSystem.nullable(),
  servesAreaIds: z.array(z.string()),
};

/** S17a Νέο πάγιο — `POST /assets`. */
export const AssetCreateFormSchema = z.object({
  orgUnitId: z.string().min(1, "forms.required"),
  ...sharedFields,
});

/** S17a Επεξεργασία — `PATCH /assets/:id`. No `orgUnitId`: the register is scoped by unit at creation, the same way a project's unit is fixed (ADR-0014's precedent). */
export const AssetEditFormSchema = z.object({ ...sharedFields });
