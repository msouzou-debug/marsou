// S07c — R09

import { z } from "zod";
import { RFI_RECIPIENT_EMAIL_MAX, RFI_RECIPIENT_NAME_MAX, isCalendarDate, nicosiaDateOf } from "@ecapital/shared";

export interface InstructionFormValues {
  textEl: string;
  costImpactFlag: boolean;
  issuedOn: string; // yyyy-mm-dd, from a date input; today by default
  // Owner request 26/11/2026: who it went to, the address used in Outlook and
  // the day it left. All optional; blank is "" here and is left out (new) or
  // cleared to null (edit) on the way to the API (`InstructionsScreen`).
  recipientName: string;
  recipientEmail: string;
  sentOn: string; // yyyy-mm-dd, or ""
}

/**
 * The same form adds and edits an instruction (UAT 25/11/2026). RULE (owner,
 * UAT 25/11/2026): the day it was issued has already happened, so it is not
 * after today — the API refuses the same with errors.dateInFuture. «Today»
 * is read when the form is checked, in Europe/Nicosia.
 *
 * RULE (owner, 26/11/2026, the RFI's rule): the day it was sent is not after
 * today and not before the day it was issued (the API:
 * errors.siteInstructionSentBeforeIssued).
 */
export const InstructionFormSchema = z
  .object({
    textEl: z.string().trim().min(1, "forms.required"),
    costImpactFlag: z.boolean(),
    issuedOn: z
      .string()
      .min(1, "forms.required")
      .refine(isCalendarDate, "forms.invalidDate")
      .refine((value) => !isCalendarDate(value) || value <= nicosiaDateOf(new Date()), "forms.dateInFuture"),
    recipientName: z.string().trim().max(RFI_RECIPIENT_NAME_MAX, "forms.tooLong"),
    recipientEmail: z
      .string()
      .trim()
      .max(RFI_RECIPIENT_EMAIL_MAX, "forms.emailInvalid")
      .refine((value) => value === "" || z.email().safeParse(value).success, "forms.emailInvalid"),
    sentOn: z
      .string()
      .refine((value) => value === "" || isCalendarDate(value), "forms.invalidDate")
      .refine((value) => value === "" || !isCalendarDate(value) || value <= nicosiaDateOf(new Date()), "forms.dateInFuture"),
  })
  .superRefine((values, ctx) => {
    if (values.sentOn && isCalendarDate(values.sentOn) && isCalendarDate(values.issuedOn) && values.sentOn < values.issuedOn) {
      ctx.addIssue({ code: "custom", path: ["sentOn"], message: "forms.sentBeforeIssued" });
    }
  });
