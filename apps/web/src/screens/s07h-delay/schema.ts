// S07h — ADR-0035
//
// Client-side validation for the three small forms on «Προθεσμίες και
// ρήτρες», on top of `packages/shared`'s `ContractSectionWrite`,
// `ContractExtensionWrite` and `DelayActivation`. The API re-validates the
// same bodies; what this file adds is the message a person sees, as an i18n
// key (`forms.*`) — see `lib/zod-resolver.ts`.
//
// RULE (date sanity, the shared lists the API checks too): a handover, an
// extension's approval and an activation are facts, so none is after today
// in Nicosia; an extension is not approved before the contract was awarded.
// A section's contractual completion date is a plan and may be in the future.
import { z } from "zod";
import {
  CONTRACT_EXTENSION_DATE_RULES,
  CONTRACT_SECTION_DATE_RULES,
  DELAY_ACTIVATION_DATE_RULES,
  ExtensionApprover,
  refineDates,
} from "@ecapital/shared";

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

export const SectionFormSchema = z
  .object({
    code: z.string().trim().min(1, "forms.required").max(8, "forms.codeLength"),
    titleEl: required,
    completionDate: dateRequired,
    handoverDate: z.string(),
    liquidatedDamagesPerDay: z
      .number()
      .nullable()
      .refine((value) => value === null || (!Number.isNaN(value) && value >= 0), "forms.nonNegative"),
  })
  .superRefine(refineDates(CONTRACT_SECTION_DATE_RULES));

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

const extensionFields = z.object({
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

/** For a contract awarded on `awardDate` ("" when unknown: the «not after today» half only). */
export function extensionFormSchema(awardDate = "") {
  const rule = refineDates(CONTRACT_EXTENSION_DATE_RULES, { dateOrder: "forms.dateBeforeAward" });
  return extensionFields.superRefine((values, ctx) => rule({ ...values, awardDate: awardDate || undefined }, ctx));
}

export const ExtensionFormSchema = extensionFormSchema();

export interface ActivationFormValues {
  activatedAt: string;
  noteEl: string;
}

export const ActivationFormSchema = z
  .object({
    activatedAt: dateRequired,
    noteEl: required,
  })
  .superRefine(refineDates(DELAY_ACTIVATION_DATE_RULES));
