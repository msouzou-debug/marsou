// S05 — R06
//
// Client-side validation for the «Προσθήκη» dialog (`MilestoneAddDialog.tsx`),
// on top of `packages/shared`'s `MilestoneWrite`. `sortOrder` is not a form
// field — the screen computes "one past the current last row" itself (the
// build brief's "sortOrder default last") — and the baseline date, once
// this form has created the milestone, never appears in an editable field
// again (ADR-0014).
import { z } from "zod";
import { isIsoDate } from "./milestone-status";

export interface MilestoneFormValues {
  titleEl: string;
  baselineDate: string;
  isGate: boolean;
}

export const MilestoneFormSchema = z.object({
  titleEl: z.string().trim().min(1, "forms.required"),
  baselineDate: z
    .string()
    .trim()
    .min(1, "forms.required")
    .refine(isIsoDate, "forms.invalidDate"),
  isGate: z.boolean(),
});
