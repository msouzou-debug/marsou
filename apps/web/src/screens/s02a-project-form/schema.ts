// S02a — R04, R05
//
// Client-side validation for the create/edit form (`ProjectForm.tsx`). Built
// on top of `packages/shared`'s `ProjectCreate`/`ProjectUpdate`, not instead
// of them: the API re-validates the same body with the same zod schemas, so
// nothing here can let through what the API would refuse. What this file
// adds is the message a person actually sees. A bare shared field (e.g.
// `Project.titleEl` is `z.string()`, no `.min()` — an empty title is not the
// API's problem to reject, an unwritten title is a data-quality choice CAPEX
// leaves open elsewhere in the register) says nothing about an empty title,
// so several fields are redeclared here with the stricter rule the form
// needs and an i18n key (`forms.*`) as the zod message. `ProjectForm`
// translates that key with `t(error.message)` (see `lib/zod-resolver.ts` for
// why the message is a key, not a sentence).
import { z } from "zod";
import { FundingSource, ProjectCategory } from "@ecapital/shared";

// The eleven fields the form edits. Deliberately not `sponsorId` /
// `projectManagerId` (`ProjectCreate` carries them, but nothing in this
// build gives the form a directory of people to pick from — see the
// hand-back summary) and never `orgUnitId`/`code` for `ProjectUpdate`, which
// cannot change either after the project exists (ADR-0014).
export interface ProjectFormValues {
  titleEl: string;
  titleEn: string | null;
  category: ProjectCategory;
  fundingSource: FundingSource;
  approvedBudget: number;
  plannedStart: string | null;
  plannedFinish: string | null;
  budgetYearFrom: number | null;
  budgetYearTo: number | null;
  sapWbs: string | null;
  tenderReference: string | null;
}

export interface ProjectCreateFormValues extends ProjectFormValues {
  orgUnitId: string;
}

// `<input type="number">`/`<input type="date">` report their value as a
// string in the DOM; empty is `""`. Each field below is registered with
// `setValueAs` (see `ProjectForm.tsx`) so react-hook-form already hands zod
// the target type — `""` becomes `NaN` for the budget (a number the
// `refine` below can name as "missing", rather than a type error zod would
// phrase in English) and `null` for every optional string/date/year, which
// is what `ProjectUpdate`/`ProjectCreate` require for those (`nullable()`,
// not `optional()` — CAPEX-03 §2's "the date cell can be missing").
const titleEl = z.string().trim().min(1, "forms.required");

const approvedBudget = z
  .number()
  .refine((value) => !Number.isNaN(value), "forms.required")
  .nonnegative("forms.nonNegative");

const nullableYear = z.number().int().nullable();
const nullableString = z.string().nullable();

// RULE (CAPEX-03 §2 / ADR-0014): a planned date can be missing, so both
// dates are optional on their own — but a finish before its own start is
// never right, whichever of the two is missing.
function refineDateOrder<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data: unknown, ctx) => {
    const { plannedStart, plannedFinish } = data as {
      plannedStart?: string | null;
      plannedFinish?: string | null;
    };
    if (plannedStart && plannedFinish && plannedFinish < plannedStart) {
      ctx.addIssue({ code: "custom", message: "forms.dateOrder", path: ["plannedFinish"] });
    }
  });
}

const sharedFields = {
  titleEl,
  titleEn: nullableString,
  category: ProjectCategory,
  fundingSource: FundingSource,
  approvedBudget,
  plannedStart: nullableString,
  plannedFinish: nullableString,
  budgetYearFrom: nullableYear,
  budgetYearTo: nullableYear,
  sapWbs: nullableString,
  tenderReference: nullableString,
};

/** S02a Νέο έργο — `POST /projects`. */
export const ProjectCreateFormSchema = refineDateOrder(
  z.object({
    orgUnitId: z.string().min(1, "forms.required"),
    ...sharedFields,
  }),
);

/** S02a Επεξεργασία — `PATCH /projects/:id`. No `orgUnitId`: it never changes
 *  after the project is opened (ADR-0014). */
export const ProjectEditFormSchema = refineDateOrder(z.object({ ...sharedFields }));
