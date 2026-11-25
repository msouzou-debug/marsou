// S09 — R11

// Client-side validation for the new-certificate form (`CertificateForm.tsx`),
// on top of `packages/shared`'s `PaymentCertCreate` the same way every other
// form in this app sits on top of its shared write type.
//
// RULE (date sanity, PAYMENT_CERT_DATE_RULES — the API checks the same list
// and answers errors.certPeriodNotValid): the period cannot end before it
// starts.
import { z } from "zod";
import { PAYMENT_CERT_DATE_RULES, refineDates } from "@ecapital/shared";

export interface CertificateFormValues {
  periodFrom: string;
  periodTo: string;
  workDoneValue: number;
  materialsOnSite: number;
}

export const CertificateFormSchema = z
  .object({
    periodFrom: z.string().min(1, "forms.required"),
    periodTo: z.string().min(1, "forms.required"),
    workDoneValue: z.number().refine((value) => !Number.isNaN(value) && value >= 0, "forms.nonNegative"),
    materialsOnSite: z.number().refine((value) => !Number.isNaN(value) && value >= 0, "forms.nonNegative"),
  })
  .superRefine(refineDates(PAYMENT_CERT_DATE_RULES, { dateOrder: "forms.dateEndBeforeStart" }));
