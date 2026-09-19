"use client";

// S02a — R04, R05
//
/**
 * ProjectFormScreen — the network-aware wrapper around `ProjectForm` (same
 * Screen/pure split as every other screen — see `s01-portfolio/Portfolio.tsx`'s
 * header comment). The only place that calls `apiMutate` for a project
 * create or edit.
 *
 * `mode: "create"` posts to `POST /projects` and lands on the new project's
 * own page (`/projects/<id>`) — the id the API allocates, never one this
 * screen invents (ADR-0014). `mode: "edit"` patches `PATCH /projects/:id`
 * and returns to the same project's overview.
 *
 * | Prop             | Type                | Notes                                                        |
 * |------------------|---------------------|------------------------------------------------------------------|
 * | mode             | "create" \| "edit"  |                                                                    |
 * | orgUnits         | OrgUnit[]           | The caller's own visible units (R01).                             |
 * | defaultOrgUnitId | string?             | The shell's unit cookie — preselects Μονάδα in "create".          |
 * | projectId        | string?             | Required in "edit"; the id being patched.                         |
 * | initialValues    | ProjectFormValues?  | Required in "edit"; prefills the form.                            |
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ProjectDetail, type OrgUnit } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { ProjectForm, type ProjectFormSubmitValues } from "./ProjectForm";
import type { ProjectFormValues } from "./schema";

export interface ProjectFormScreenProps {
  mode: "create" | "edit";
  orgUnits: OrgUnit[];
  defaultOrgUnitId?: string;
  projectId?: string;
  initialValues?: ProjectFormValues;
}

export function ProjectFormScreen({
  mode,
  orgUnits,
  defaultOrgUnitId,
  projectId,
  initialValues,
}: ProjectFormScreenProps) {
  const t = useTranslations();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);
  const [budgetFieldError, setBudgetFieldError] = useState<string | undefined>(undefined);

  async function handleSubmit(values: ProjectFormSubmitValues) {
    setSubmitting(true);
    setApiError(undefined);
    setBudgetFieldError(undefined);
    try {
      const project =
        mode === "create"
          ? await apiMutate("/projects", "POST", values, ProjectDetail)
          : await apiMutate(
              `/projects/${encodeURIComponent(projectId ?? "")}`,
              "PATCH",
              // `orgUnitId` never reaches `PATCH` — `ProjectUpdate` has no such
              // field, and it cannot change after the project opens (ADR-0014).
              { ...values, orgUnitId: undefined },
              ProjectDetail,
            );
      router.push(`/projects/${encodeURIComponent(project.id)}`);
      return;
    } catch (error) {
      // RULE (ADR-0014, decided 19/09/2026): finance-only after APPROVED —
      // the field-level message, not the general strip. Every other failure
      // (a read-only role, a network error, an unreachable API) is the
      // general strip, with the API's own sentence when there is one.
      if (error instanceof ApiError && error.status === 403 && error.key === "errors.budgetFinanceOnly") {
        setBudgetFieldError(error.message);
      } else if (error instanceof ApiError) {
        setApiError(error.message);
      } else {
        setApiError(t("states.error.generic"));
      }
    }
    setSubmitting(false);
  }

  function handleCancel() {
    router.push(mode === "edit" && projectId ? `/projects/${encodeURIComponent(projectId)}` : "/projects");
  }

  return (
    <ProjectForm
      mode={mode}
      orgUnits={orgUnits}
      defaultOrgUnitId={defaultOrgUnitId}
      initialValues={initialValues}
      submitting={submitting}
      apiError={apiError}
      budgetFieldError={budgetFieldError}
      onSubmit={handleSubmit}
      onCancel={handleCancel}
    />
  );
}
