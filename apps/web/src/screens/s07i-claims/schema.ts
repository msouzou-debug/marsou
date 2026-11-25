// S07i — ADR-0035
//
// Client-side validation for the claim form, on top of `ContractClaimWrite`.
// Messages are i18n keys (`forms.*`), see `lib/zod-resolver.ts`.
//
// RULE (date sanity, CONTRACT_CLAIM_DATE_RULES): «Ημερομηνία κοινοποίησης» is
// the day the claim reached the other side, so it is not after today in
// Nicosia, and it is not before the contract was awarded. The API checks the
// same list (errors.dateInFuture, errors.dateBeforeAward); this says it under
// the field first. The award date is the contract's, so the schema is built
// for one contract.
import { z } from "zod";
import { CONTRACT_CLAIM_DATE_RULES, ClaimDirection, ClaimDocumentKind, ClaimStage, refineDates } from "@ecapital/shared";

export interface ClaimFormValues {
  direction: ClaimDirection;
  titleEl: string;
  amount: number;
  stage: ClaimStage;
  /** "" while there is no date. */
  notifiedAt: string;
  legalAdvisorEl: string;
  contingentLiability: boolean;
  notesEl: string;
}

/**
 * A paper picked on the sheet, filed right after the claim is saved (0029):
 * the letter or e-mail that made the claim, the reply, a lawyer's letter.
 */
export interface ClaimAttachment {
  file: File;
  kind: ClaimDocumentKind;
  /** "" leaves the title to the API, which uses the subject line. */
  titleEl: string;
}

const fields = z.object({
  direction: ClaimDirection,
  titleEl: z.string().trim().min(1, "forms.required"),
  amount: z
    .number()
    .refine((value) => !Number.isNaN(value), "forms.required")
    .refine((value) => value >= 0, "forms.nonNegative"),
  stage: ClaimStage,
  notifiedAt: z.string(),
  legalAdvisorEl: z.string(),
  contingentLiability: z.boolean(),
  notesEl: z.string(),
});

/** The form's schema for a claim on a contract awarded on `awardDate` ("" when unknown). */
export function claimFormSchema(awardDate = "", today?: () => string) {
  const rule = refineDates(CONTRACT_CLAIM_DATE_RULES, { dateOrder: "forms.dateBeforeAward" }, today);
  return fields.superRefine((values, ctx) => rule({ ...values, awardDate: awardDate || undefined }, ctx));
}

/** Without a contract to hand: the «not after today» half only. */
export const ClaimFormSchema = claimFormSchema();
