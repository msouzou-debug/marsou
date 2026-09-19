// S07d — R12, R35 (ADR-0017)

import { z } from "zod";
import { RiskBand } from "@ecapital/shared";

export interface DefectCreateFormValues {
  descriptionEl: string;
  areaId: string; // "" means none — DefectsScreen turns that into `null`.
  estimatedCost: number; // NaN means "not given" — turned into `null`.
  riskBand: z.infer<typeof RiskBand>;
}

export const DefectCreateFormSchema = z.object({
  descriptionEl: z.string().trim().min(1, "forms.required"),
  areaId: z.string(),
  estimatedCost: z.number(),
  riskBand: RiskBand,
});

export interface DefectUpdateFormValues {
  descriptionEl: string;
  estimatedCost: number;
  riskBand: z.infer<typeof RiskBand>;
  funded: boolean;
  targetProjectId: string; // "" means none.
  status: "OPEN" | "IN_PROGRESS" | "CLOSED";
}

// RULE (ADR-0017, mirrored client-side): funded needs a target project — the
// API's own `errors.fundedNeedsProject`. Checked here so the form never
// makes the round trip only to be refused.
export const DefectUpdateFormSchema = z
  .object({
    descriptionEl: z.string().trim().min(1, "forms.required"),
    estimatedCost: z.number(),
    riskBand: RiskBand,
    funded: z.boolean(),
    targetProjectId: z.string(),
    status: z.enum(["OPEN", "IN_PROGRESS", "CLOSED"]),
  })
  .refine((values) => !values.funded || values.targetProjectId.trim().length > 0, {
    message: "screens.s07d.fundedNeedsProject",
    path: ["targetProjectId"],
  });
