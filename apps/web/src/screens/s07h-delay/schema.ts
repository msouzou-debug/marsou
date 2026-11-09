// S07h — ADR-0035
//
// Client-side validation for the three small forms on «Προθεσμίες και
// ρήτρες», on top of `packages/shared`'s `ContractSectionWrite`,
// `ContractExtensionWrite` and `DelayActivation`. The API re-validates the
// same bodies; what this file adds is the message a person sees, as an i18n
// key (`forms.*`) — see `lib/zod-resolver.ts`.
import { z } from "zod";
import { ExtensionApprover } from "@ecapital/shared";

const required = z.string().trim().min(1, "forms.required");
const dateRequired = z.string().min(1, "forms.required");

export interface SectionFormValues {
  code: string;
  titleEl: string;
  completionDate: string;
  /** "" while the section has not been handed over. */
  handoverDate: string;
  /** null means the contract's own rate applies. */
  liquidatedDamagesPerDay: number | null;
}

export const SectionFormSchema = z.object({
  code: z.string().trim().min(1, "forms.required").max(8, "forms.codeLength"),
  titleEl: required,
  completionDate: dateRequired,
  handoverDate: z.string(),
  liquidatedDamagesPerDay: z
    .number()
    .nullable()
    .refine((value) => value === null || (!Number.isNaN(value) && value >= 0), "forms.nonNegative"),
});

export interface ExtensionFormValues {
  /** "" means the contract's own clock. */
  sectionId: string;
  days: number;
  approvedAt: string;
  approver: ExtensionApprover | "";
  approverNameEl: string;
  reasonEl: string;
  /** Explicit: the judgement is the point, so there is no default. */
  contractorCulpable: "yes" | "no" | "";
}

export const ExtensionFormSchema = z.object({
  sectionId: z.string(),
  days: z
    .number()
    .refine((value) => !Number.isNaN(value), "forms.required")
    .refine((value) => Number.isInteger(value) && value > 0, "forms.positiveDays"),
  approvedAt: dateRequired,
  approver: z.union([ExtensionApprover, z.literal("")]).refine((value) => value !== "", "forms.required"),
  approverNameEl: required,
  reasonEl: required,
  contractorCulpable: z.enum(["yes", "no", ""]).refine((value) => value !== "", "forms.required"),
});

export interface ActivationFormValues {
  activatedAt: string;
  noteEl: string;
}

export const ActivationFormSchema = z.object({
  activatedAt: dateRequired,
  noteEl: required,
});
