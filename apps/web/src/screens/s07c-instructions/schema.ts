// S07c — R09

import { z } from "zod";
import { isCalendarDate, nicosiaDateOf } from "@ecapital/shared";

export interface InstructionFormValues {
  textEl: string;
  costImpactFlag: boolean;
  issuedOn: string; // yyyy-mm-dd, from a date input; today by default
}

/**
 * The same form adds and edits an instruction (UAT 25/11/2026). RULE (owner,
 * UAT 25/11/2026): the day it was issued has already happened, so it is not
 * after today — the API refuses the same with errors.dateInFuture. «Today»
 * is read when the form is checked, in Europe/Nicosia.
 */
export const InstructionFormSchema = z.object({
  textEl: z.string().trim().min(1, "forms.required"),
  costImpactFlag: z.boolean(),
  issuedOn: z
    .string()
    .min(1, "forms.required")
    .refine(isCalendarDate, "forms.invalidDate")
    .refine((value) => !isCalendarDate(value) || value <= nicosiaDateOf(new Date()), "forms.dateInFuture"),
});
