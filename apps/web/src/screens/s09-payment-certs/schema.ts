// S09 — R11

// Client-side validation for the new-certificate form (`CertificateForm.tsx`),
// on top of `packages/shared`'s `PaymentCertCreate` the same way every other
// form in this app sits on top of its shared write type.
import { z } from "zod";

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
  .refine((values) => values.periodTo >= values.periodFrom, {
    message: "forms.dateOrder",
    path: ["periodTo"],
  });
