// S07i — ADR-0035
//
// Client-side validation for the claim form, on top of `ContractClaimWrite`.
// Messages are i18n keys (`forms.*`), see `lib/zod-resolver.ts`.
import { z } from "zod";
import { ClaimDirection, ClaimStage } from "@ecapital/shared";

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

export const ClaimFormSchema = z.object({
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
