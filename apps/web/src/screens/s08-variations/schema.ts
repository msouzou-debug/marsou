// S08 — R10

// Client-side validation for the variation edit form (`VariationSheet.tsx`),
// on top of `packages/shared`'s `VariationCreate` the same way every other
// form in this app sits on top of its shared write type.
import { z } from "zod";
import { VariationReason } from "@ecapital/shared";

export interface VariationFormValues {
  descriptionEl: string;
  reason: VariationReason;
  value: number;
  timeImpactDays: number;
}

export const VariationFormSchema = z.object({
  descriptionEl: z.string().trim().min(1, "forms.required"),
  reason: VariationReason,
  // RULE (contract `Variation.value`): a variation may be negative — an
  // omission reduces the contract. Only "not a number" is refused here.
  value: z.number().refine((value) => !Number.isNaN(value), "forms.required"),
  timeImpactDays: z
    .number()
    .int()
    .refine((value) => !Number.isNaN(value), "forms.required"),
});
