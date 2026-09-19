// S04 — R16

// Client-side validation for the «Παράμετροι πρόβλεψης» inline form
// (`ForecastInputsForm.tsx`), the same pattern every write form in this app
// sits on top of its shared `packages/shared` write type (`ForecastInputs`).
import { z } from "zod";

export interface ForecastInputsFormValues {
  contingency: number;
  pendingVariationWeight: number;
  contingencyNoteEl: string;
}

export const ForecastInputsFormSchema = z.object({
  contingency: z.number().refine((value) => !Number.isNaN(value) && value >= 0, "forms.nonNegative"),
  pendingVariationWeight: z
    .number()
    .refine((value) => !Number.isNaN(value) && value >= 0 && value <= 1, "forms.weightRange"),
  // Free text; empty is allowed (sent as null — see `ForecastInputsForm`'s onSubmit).
  contingencyNoteEl: z.string(),
});
