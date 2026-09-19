// S07b — R09

// Client-side validation on top of `packages/shared`'s `RfiCreate`/`RfiAnswer`,
// the same pattern S08's own `schema.ts` sits on top of `VariationCreate`.
import { z } from "zod";

export interface RfiFormValues {
  questionEl: string;
  slaDays: number;
}

export const RfiFormSchema = z.object({
  questionEl: z.string().trim().min(1, "forms.required"),
  slaDays: z
    .number()
    .int()
    .min(1)
    .max(60)
    .refine((value) => !Number.isNaN(value), "forms.required"),
});

export interface RfiAnswerFormValues {
  answerEl: string;
}

export const RfiAnswerFormSchema = z.object({
  answerEl: z.string().trim().min(1, "forms.required"),
});
