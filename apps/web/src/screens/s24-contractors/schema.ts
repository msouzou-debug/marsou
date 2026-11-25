// S24 — R08

// Client-side validation for the contractor create/edit sheet
// (`ContractorSheet.tsx`), on top of `packages/shared`'s `ContractorCreate`.
import { z } from "zod";
import { CONTACT_EMAIL_MAX, CONTACT_NAME_MAX, ContractorCategory, isContactPhone } from "@ecapital/shared";

export interface ContractorFormValues {
  name: string;
  vatNumber: string | null;
  registrationNo: string | null;
  category: ContractorCategory;
  sapVendorId: string | null;
  // Owner UAT 25/11/2026: who to write to. Blank is null; the API marks
  // what a user types here as MANUAL, which the eFinance sync never
  // overwrites. No bank details belong here.
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

const nullableString = z.string().nullable();

export const ContractorFormSchema = z.object({
  name: z.string().trim().min(1, "forms.required"),
  vatNumber: nullableString,
  registrationNo: nullableString,
  category: ContractorCategory,
  sapVendorId: nullableString,
  contactName: z.string().trim().max(CONTACT_NAME_MAX, "forms.tooLong").nullable(),
  contactEmail: z
    .string()
    .trim()
    .max(CONTACT_EMAIL_MAX, "forms.emailInvalid")
    .refine((value) => z.email().safeParse(value).success, "forms.emailInvalid")
    .nullable(),
  contactPhone: z.string().trim().refine(isContactPhone, "forms.phoneInvalid").nullable(),
});
