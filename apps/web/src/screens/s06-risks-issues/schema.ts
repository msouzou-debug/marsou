// S06 — R07
//
// Client-side validation for the risk and issue sheets, on top of
// `packages/shared`'s `RiskWrite`/`IssueWrite`.
import { z } from "zod";
import { IssueStatus, RiskStatus } from "@ecapital/shared";

export interface RiskFormValues {
  descriptionEl: string;
  likelihood: number;
  impact: number;
  ownerId: string | null;
  mitigationEl: string | null;
  status: RiskStatus;
}

const scale = z.number().int().min(1, "forms.required").max(5, "forms.required");

export const RiskFormSchema = z.object({
  descriptionEl: z.string().trim().min(1, "forms.required"),
  likelihood: scale,
  impact: scale,
  ownerId: z.string().nullable(),
  mitigationEl: z.string().nullable(),
  status: RiskStatus,
});

export interface IssueFormValues {
  descriptionEl: string;
  dueDate: string | null;
  status: IssueStatus;
}

export const IssueFormSchema = z.object({
  descriptionEl: z.string().trim().min(1, "forms.required"),
  dueDate: z.string().nullable(),
  status: IssueStatus,
});
