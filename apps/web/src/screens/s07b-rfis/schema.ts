// S07b — R09

// Client-side validation on top of `packages/shared`'s `RfiCreate`/`RfiAnswer`/
// `RfiUpdate`, the same pattern S08's own `schema.ts` sits on top of
// `VariationCreate`.
import { z } from "zod";
import { RFI_RECIPIENT_EMAIL_MAX, RFI_RECIPIENT_NAME_MAX, isCalendarDate } from "@ecapital/shared";

/**
 * Owner decision 25/11/2026: eCapital sends no e-mail. The form records who
 * the RFI went to (required on a new RFI), the address used in Outlook
 * (optional) and the day it was sent (optional). Blank fields are "" here and
 * become `null` or are left out on the way to the API (`RfisScreen`).
 */
export interface RfiFormValues {
  questionEl: string;
  slaDays: number;
  recipientName: string;
  recipientEmail: string;
  sentOn: string; // yyyy-mm-dd from a date input, or ""
}

const recipientEmail = z
  .string()
  .trim()
  .max(RFI_RECIPIENT_EMAIL_MAX, "forms.emailInvalid")
  .refine((value) => value === "" || z.email().safeParse(value).success, "forms.emailInvalid");

/**
 * RULE (owner, UAT 25/11/2026): the day it was sent is not after today and
 * not before the day the RFI was raised (`raisedOn`, yyyy-mm-dd in Nicosia).
 * On a new RFI both are today. The API refuses the same with
 * errors.dateInFuture and errors.rfiSentBeforeRaised.
 */
function sentOnField(raisedOn: string, today: string) {
  return z
    .string()
    .refine((value) => value === "" || isCalendarDate(value), "forms.invalidDate")
    .refine((value) => value === "" || !isCalendarDate(value) || value <= today, "forms.dateInFuture")
    .refine((value) => value === "" || !isCalendarDate(value) || value >= raisedOn, "forms.sentBeforeRaised");
}

/** «Προσθήκη»: `today` is yyyy-mm-dd in Europe/Nicosia. */
export function rfiFormSchema(today: string) {
  return z.object({
    questionEl: z.string().trim().min(1, "forms.required"),
    slaDays: z
      .number()
      .int()
      .min(1)
      .max(60)
      .refine((value) => !Number.isNaN(value), "forms.required"),
    recipientName: z.string().trim().min(1, "forms.required").max(RFI_RECIPIENT_NAME_MAX, "forms.required"),
    recipientEmail,
    sentOn: sentOnField(today, today),
  });
}

export interface RfiAnswerFormValues {
  answerEl: string;
}

export const RfiAnswerFormSchema = z.object({
  answerEl: z.string().trim().min(1, "forms.required"),
});

/** UAT 25/11/2026 — the «Επεξεργασία» form: the question, the due date, and who it went to and when. */
export interface RfiEditFormValues {
  questionEl: string;
  dueDate: string; // yyyy-mm-dd, from a date input
  recipientName: string;
  recipientEmail: string;
  sentOn: string;
}

/**
 * RULE (owner, UAT 25/11/2026): the due date is not before the day the RFI
 * was raised (`raisedOn`, yyyy-mm-dd in Europe/Nicosia). The API refuses the
 * same with errors.rfiDueBeforeRaised; this says it under the field first.
 *
 * `recipientRequired`: an RFI raised before the recipient existed has none,
 * and correcting its question does not force somebody to invent one. Once a
 * recipient is recorded it is corrected, not removed.
 */
export function rfiEditFormSchema(raisedOn: string, today: string, recipientRequired = true) {
  return z.object({
    questionEl: z.string().trim().min(1, "forms.required"),
    dueDate: z
      .string()
      .min(1, "forms.required")
      .refine(isCalendarDate, "forms.invalidDate")
      .refine((value) => !isCalendarDate(value) || value >= raisedOn, "forms.dueBeforeRaised"),
    recipientName: recipientRequired
      ? z.string().trim().min(1, "forms.required").max(RFI_RECIPIENT_NAME_MAX, "forms.required")
      : z.string().trim().max(RFI_RECIPIENT_NAME_MAX, "forms.required"),
    recipientEmail,
    sentOn: sentOnField(raisedOn, today),
  });
}

/** The evidence upload: a file, and a title of at least 3 characters when one is given. */
export function evidenceTitleError(title: string): string | undefined {
  const trimmed = title.trim();
  return trimmed !== "" && trimmed.length < 3 ? "forms.titleTooShort" : undefined;
}
