// S09 — R11

// Client-side validation for the new-certificate form (`CertificateForm.tsx`),
// on top of `packages/shared`'s `PaymentCertCreate` the same way every other
// form in this app sits on top of its shared write type.
//
// RULE (date sanity, PAYMENT_CERT_DATE_RULES — the API checks the same list
// and answers errors.certPeriodNotValid): the period cannot end before it
// starts.
import { z } from "zod";
import { PAYMENT_CERT_DATE_RULES, VatRate, refineDates, roundMoney } from "@ecapital/shared";

export interface CertificateFormValues {
  periodFrom: string;
  periodTo: string;
  workDoneValue: number;
  materialsOnSite: number;
  /** ADR-0038: the contract's rate unless chosen otherwise. */
  vatRate: VatRate;
}

/**
 * The net payable the API will work out (`derivePaymentCert`): work done +
 * materials − retention − what earlier certificates certified. Shown live
 * so the person sees the VAT and the gross before saving; the API's figure
 * is the one stored. Null while a figure is missing.
 */
export function estimatedNetPayable(input: {
  workDoneValue: number;
  materialsOnSite: number;
  retentionPct: number | undefined;
  previousCertified: number | undefined;
}): number | null {
  const { workDoneValue, materialsOnSite, retentionPct, previousCertified } = input;
  if (!Number.isFinite(workDoneValue) || !Number.isFinite(materialsOnSite)) return null;
  if (retentionPct === undefined || previousCertified === undefined) return null;
  const gross = roundMoney(workDoneValue + materialsOnSite);
  const retention = roundMoney((gross * retentionPct) / 100);
  return roundMoney(gross - retention - roundMoney(previousCertified));
}

export const CertificateFormSchema = z
  .object({
    periodFrom: z.string().min(1, "forms.required"),
    periodTo: z.string().min(1, "forms.required"),
    workDoneValue: z.number().refine((value) => !Number.isNaN(value) && value >= 0, "forms.nonNegative"),
    materialsOnSite: z.number().refine((value) => !Number.isNaN(value) && value >= 0, "forms.nonNegative"),
    vatRate: VatRate,
  })
  .superRefine(refineDates(PAYMENT_CERT_DATE_RULES, { dateOrder: "forms.dateEndBeforeStart" }));
