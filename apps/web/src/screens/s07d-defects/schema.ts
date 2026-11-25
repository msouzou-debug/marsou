// S07d — R12, R35 (ADR-0017)

import { z } from "zod";
import { RiskBand, isCalendarDate, nicosiaDateOf } from "@ecapital/shared";

/**
 * RULE (owner, UAT 25/11/2026): the day a defect was found has already
 * happened, so it is not after today — the API refuses the same with
 * errors.dateInFuture. «Today» is read when the form is checked, in
 * Europe/Nicosia.
 */
const raisedOn = z
  .string()
  .min(1, "forms.required")
  .refine(isCalendarDate, "forms.invalidDate")
  .refine((value) => !isCalendarDate(value) || value <= nicosiaDateOf(new Date()), "forms.dateInFuture");

export interface DefectCreateFormValues {
  descriptionEl: string;
  areaId: string; // "" means none — DefectsScreen turns that into `null`.
  estimatedCost: number; // NaN means "not given" — turned into `null`.
  riskBand: z.infer<typeof RiskBand>;
  raisedOn: string; // yyyy-mm-dd; today by default
}

export const DefectCreateFormSchema = z.object({
  descriptionEl: z.string().trim().min(1, "forms.required"),
  areaId: z.string(),
  // A blank cost is NaN from the input, and "not given" (null) on the way out.
  estimatedCost: z.union([z.number(), z.nan()]),
  riskBand: RiskBand,
  raisedOn,
});

export interface DefectUpdateFormValues {
  descriptionEl: string;
  estimatedCost: number;
  riskBand: z.infer<typeof RiskBand>;
  funded: boolean;
  targetProjectId: string; // "" means none.
  status: "OPEN" | "IN_PROGRESS" | "CLOSED";
  raisedOn: string; // yyyy-mm-dd
}

// RULE (ADR-0017, mirrored client-side): funded needs a target project — the
// API's own `errors.fundedNeedsProject`. Checked here so the form never
// makes the round trip only to be refused.
export const DefectUpdateFormSchema = z
  .object({
    descriptionEl: z.string().trim().min(1, "forms.required"),
    estimatedCost: z.union([z.number(), z.nan()]),
    riskBand: RiskBand,
    funded: z.boolean(),
    targetProjectId: z.string(),
    status: z.enum(["OPEN", "IN_PROGRESS", "CLOSED"]),
    raisedOn,
  })
  .refine((values) => !values.funded || values.targetProjectId.trim().length > 0, {
    message: "screens.s07d.fundedNeedsProject",
    path: ["targetProjectId"],
  });
