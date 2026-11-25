// S07b — R09

// Client-side validation on top of `packages/shared`'s `RfiCreate`/`RfiAnswer`/
// `RfiUpdate`, the same pattern S08's own `schema.ts` sits on top of
// `VariationCreate`.
import { z } from "zod";
import { isCalendarDate } from "@ecapital/shared";

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

/** UAT 25/11/2026 — the «Επεξεργασία» form: the question and the due date. */
export interface RfiEditFormValues {
  questionEl: string;
  dueDate: string; // yyyy-mm-dd, from a date input
}

/**
 * RULE (owner, UAT 25/11/2026): the due date is not before the day the RFI
 * was raised (`raisedOn`, yyyy-mm-dd in Europe/Nicosia). The API refuses the
 * same with errors.rfiDueBeforeRaised; this says it under the field first.
 */
export function rfiEditFormSchema(raisedOn: string) {
  return z.object({
    questionEl: z.string().trim().min(1, "forms.required"),
    dueDate: z
      .string()
      .min(1, "forms.required")
      .refine(isCalendarDate, "forms.invalidDate")
      .refine((value) => !isCalendarDate(value) || value >= raisedOn, "forms.dueBeforeRaised"),
  });
}
