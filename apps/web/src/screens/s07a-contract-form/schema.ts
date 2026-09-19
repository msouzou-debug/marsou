// S07a — R08

// Client-side validation for the create/edit contract form (`ContractForm.tsx`),
// on top of `packages/shared`'s `ContractCreate`/`ContractUpdate` the same way
// `s02a-project-form/schema.ts` sits on top of `ProjectCreate`/`ProjectUpdate`:
// the API re-validates the same body with the same zod schemas, so nothing
// here lets through what the API would refuse. What this file adds is the
// message a person actually sees, as an i18n key (`forms.*`) — see
// `lib/zod-resolver.ts` for why the message is a key, not a sentence.
import { z } from "zod";
import { ContractType, EMAP_CONTRACT_REF } from "@ecapital/shared";

// The fields the form edits. `contractorId` and `originalValue` are in the
// create schema only — RULE (ADR-0015, contract `ContractUpdate`): a
// contract's contractor cannot change after it exists, and `currentValue` is
// derived from `originalValue` plus the approved variations (a trigger
// recomputes it — ADR-0015's "The commitment"), so the API never accepts an
// edited `originalValue` either. `ContractForm.tsx` shows both as read-only
// text in edit mode rather than dropping them from view entirely.
export interface ContractFormValues {
  contractNo: string;
  type: ContractType;
  awardDate: string;
  startDate: string | null;
  completionDate: string | null;
  retentionPct: number;
  performanceBondValue: number | null;
  bondExpiry: string | null;
  liquidatedDamagesPerDay: number | null;
  defectsLiabilityMonths: number;
  sapPoNumber: string | null;
  // ADR-0019: the eMAP contract this one was procured under. Optional, and
  // validated rather than trusted — a mistyped reference makes a link on S07
  // that lands nowhere, which is worse than no link at all.
  emapRef: string | null;
  // ADR-0025, owner decision 19/09/2026: one CAPEX budget code per contract.
  // "" means none, the same convention S07d's `targetProjectId` uses for its
  // own optional select — `ContractFormScreen` turns "" into `null` before
  // the request body is built. `ContractCreateFormSchema` below refuses the
  // empty value: required on a new contract, editable (including back to
  // nothing) afterwards.
  budgetCode: string;
}

export interface ContractCreateFormValues extends ContractFormValues {
  contractorId: string;
  originalValue: number;
}

const contractNo = z.string().trim().min(1, "forms.required");
const contractorId = z.string().min(1, "forms.required");
const nonNegativeRequired = z
  .number()
  .refine((value) => !Number.isNaN(value), "forms.required")
  .nonnegative("forms.nonNegative");
const nullableNonNegative = z
  .number()
  .nullable()
  .refine((value) => value === null || value >= 0, "forms.nonNegative");
const nullableString = z.string().nullable();
// RULE (INTEGRATION-eMAP §4): eMAP's own format, exactly — CON-YYYY-NNNN.
// The API re-checks it with the same regular expression and the database
// refuses anything else as a CHECK constraint (migration 0007).
const emapRef = z
  .string()
  .nullable()
  .refine((value) => value === null || EMAP_CONTRACT_REF.test(value), "forms.emapRefFormat");
const retentionPct = z
  .number()
  .refine((value) => !Number.isNaN(value), "forms.required")
  .min(0, "forms.percentRange")
  .max(100, "forms.percentRange");
const defectsLiabilityMonths = z
  .number()
  .int()
  .refine((value) => !Number.isNaN(value), "forms.required")
  .nonnegative("forms.nonNegative");
// RULE (ADR-0025): required on a new contract — the shared `ContractCreate`
// allows null, but S07a's own form does not let a person start one without
// picking a code. Editable back to nothing afterwards (plain `z.string()`,
// used for the field in `sharedFields` below — "" passes there and is
// turned into `null` by `ContractFormScreen` before the request is sent).
const budgetCodeRequired = z.string().trim().min(1, "forms.required");

// RULE (CAPEX-03 §2 pattern reused from S02a): a start or completion date can
// be missing, but a completion before its own start never is.
function refineDateOrder<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data: unknown, ctx) => {
    const { startDate, completionDate } = data as { startDate?: string | null; completionDate?: string | null };
    if (startDate && completionDate && completionDate < startDate) {
      ctx.addIssue({ code: "custom", message: "forms.dateOrder", path: ["completionDate"] });
    }
  });
}

const sharedFields = {
  contractNo,
  type: ContractType,
  awardDate: z.string().min(1, "forms.required"),
  startDate: nullableString,
  completionDate: nullableString,
  retentionPct,
  performanceBondValue: nullableNonNegative,
  bondExpiry: nullableString,
  liquidatedDamagesPerDay: nullableNonNegative,
  defectsLiabilityMonths,
  sapPoNumber: nullableString,
  emapRef,
  // "" here for the edit schema below (means "no change" is not the rule —
  // it means "clear it"); the create schema overrides it with
  // `budgetCodeRequired`.
  budgetCode: z.string(),
};

/** S07a Νέα σύμβαση — `POST /projects/:id/contracts`. */
export const ContractCreateFormSchema = refineDateOrder(
  z.object({
    contractorId,
    originalValue: nonNegativeRequired,
    ...sharedFields,
    budgetCode: budgetCodeRequired,
  }),
);

/**
 * S07a Επεξεργασία — `PATCH /contracts/:id`. `contractorId`/`originalValue`
 * are not rendered as fields in edit mode (see header comment) but are kept
 * here, untouched, so this schema's output type still matches
 * `ContractCreateFormValues` — the one type `ContractForm.tsx` uses for
 * both modes with `useForm`. `ContractFormScreen` strips both back out
 * before the `PATCH` body is built, so a value passing through here never
 * reaches the API.
 */
export const ContractEditFormSchema = refineDateOrder(
  z.object({ contractorId: z.string(), originalValue: z.number(), ...sharedFields }),
);
