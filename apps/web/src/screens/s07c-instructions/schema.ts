// S07c — R09

import { z } from "zod";

export interface InstructionFormValues {
  textEl: string;
  costImpactFlag: boolean;
}

export const InstructionFormSchema = z.object({
  textEl: z.string().trim().min(1, "forms.required"),
  costImpactFlag: z.boolean(),
});
