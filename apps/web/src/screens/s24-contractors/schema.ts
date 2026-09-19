// S24 — R08

// Client-side validation for the contractor create/edit sheet
// (`ContractorSheet.tsx`), on top of `packages/shared`'s `ContractorCreate`.
import { z } from "zod";
import { ContractorCategory } from "@ecapital/shared";

export interface ContractorFormValues {
  name: string;
  vatNumber: string | null;
  registrationNo: string | null;
  category: ContractorCategory;
  sapVendorId: string | null;
}

const nullableString = z.string().nullable();

export const ContractorFormSchema = z.object({
  name: z.string().trim().min(1, "forms.required"),
  vatNumber: nullableString,
  registrationNo: nullableString,
  category: ContractorCategory,
  sapVendorId: nullableString,
});
