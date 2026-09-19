"use client";

// S02a — R04, R05
//
/**
 * ProjectForm — the pure S02a screen body: create at `/projects/new`, edit at
 * `/projects/[id]/edit` (UI instructions §5 "compose from the component
 * set"; there is no dedicated S02a entry in the brief's screen list, so this
 * follows S02's own Table + form pattern — a single-column form, not a
 * WizardShell, since ten fields with no branching do not need steps).
 *
 * Takes the values the caller already resolved (`ProjectFormScreen` is the
 * only place that calls `apiMutate` — same Screen/pure split as every other
 * screen in this app, see `s01-portfolio/Portfolio.tsx`'s header comment)
 * and renders react-hook-form bound to `ProjectCreateFormSchema` /
 * `ProjectEditFormSchema` (`schema.ts`) through the local `zodResolver`
 * adapter (`@/lib/zod-resolver` — `@hookform/resolvers` is not a dependency
 * of this app).
 *
 * | Prop              | Type                          | Notes                                                          |
 * |-------------------|-------------------------------|--------------------------------------------------------------------|
 * | mode              | "create" \| "edit"            | Hides the Μονάδα field and the `orgUnitId` key in "edit" — the org unit never changes after a project opens (ADR-0014). |
 * | orgUnits          | OrgUnit[]                     | The caller's own visible units (R01). Hidden entirely when there is exactly one (nothing to choose). |
 * | defaultOrgUnitId  | string?                       | Preselected from the shell's unit cookie.                       |
 * | initialValues     | ProjectFormValues?            | Prefills every field in "edit"; ignored in "create".              |
 * | submitting        | boolean                       | Disables the form and shows the spinner in Αποθήκευση.            |
 * | apiError          | string?                       | The API's own sentence, shown in a strip above the buttons — every failure except the one below. |
 * | budgetFieldError  | string?                       | RULE (ADR-0014, decided 19/09/2026): only `finance` may change `approvedBudget` once the phase is APPROVED or later. The API answers 403 `errors.budgetFinanceOnly` for anyone else's attempt to move it; that message lands here, next to the field, not in the general strip — the rest of the edit may well have gone through. |
 * | onSubmit          | (values) => void              | Fired once client-side validation passes.                        |
 * | onCancel          | () => void                    | `Ακύρωση`.                                                        |
 *
 * States: default, submitting, error (the API strip above; a client-side
 * field error is not a screen "error" state, it is normal form use). No
 * empty/noPermission/offline: a form has no list to be empty, no-permission
 * keeps the page from rendering it at all (`ProjectFormScreen`), and a write
 * screen has nothing useful to show read-only while offline (UI instructions
 * §6 "write actions … are disabled" — here that is the whole page, not a
 * state of this component).
 */

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocale, useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { FundingSource, ProjectCategory, type OrgUnit } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { zodResolver } from "@/lib/zod-resolver";
import { formatEUR } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import { ProjectCreateFormSchema, ProjectEditFormSchema, type ProjectFormValues } from "./schema";

export type ProjectFormMode = "create" | "edit";

/** What `onSubmit` hands back. `orgUnitId` is only ever populated in
 *  "create" — `ProjectEditFormSchema` has no such field, and a zod object
 *  schema strips a key it does not declare, so it is simply absent from the
 *  parsed values in "edit" (`ProjectUpdate` never carries it either). */
export type ProjectFormSubmitValues = ProjectFormValues & { orgUnitId?: string };

const EMPTY_VALUES: ProjectFormValues = {
  titleEl: "",
  titleEn: null,
  category: "NEW_BUILD",
  fundingSource: "STATE_BUDGET",
  approvedBudget: 0,
  plannedStart: null,
  plannedFinish: null,
  budgetYearFrom: null,
  budgetYearTo: null,
  sapWbs: null,
  tenderReference: null,
};

export interface ProjectFormProps {
  mode: ProjectFormMode;
  orgUnits: OrgUnit[];
  defaultOrgUnitId?: string;
  initialValues?: ProjectFormValues;
  submitting: boolean;
  apiError?: string;
  budgetFieldError?: string;
  onSubmit: (values: ProjectFormSubmitValues) => void;
  onCancel: () => void;
}

// Empty string means "as typed, blank" for a nullable text/date field; this
// is what every such field's `setValueAs` converts it to before zod sees it
// (`schema.ts`'s fields are `nullable()`, never `optional()`).
function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

export function ProjectForm({
  mode,
  orgUnits,
  defaultOrgUnitId,
  initialValues,
  submitting,
  apiError,
  budgetFieldError,
  onSubmit,
  onCancel,
}: ProjectFormProps) {
  const t = useTranslations();
  const tf = useTranslations("screens.s02a.fields");
  const locale = useLocale() as Locale;

  const resolvedDefaultUnit = useMemo(
    () => (defaultOrgUnitId && orgUnits.some((u) => u.id === defaultOrgUnitId) ? defaultOrgUnitId : orgUnits[0]?.id),
    [defaultOrgUnitId, orgUnits],
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProjectFormSubmitValues>({
    resolver:
      mode === "create"
        ? zodResolver<ProjectFormSubmitValues>(ProjectCreateFormSchema)
        : zodResolver<ProjectFormSubmitValues>(ProjectEditFormSchema),
    defaultValues: {
      orgUnitId: resolvedDefaultUnit ?? "",
      ...EMPTY_VALUES,
      ...initialValues,
    },
  });

  const [budgetDraft, setBudgetDraft] = useState(() =>
    initialValues ? String(initialValues.approvedBudget) : "0",
  );
  const budgetPreview = Number.isFinite(Number(budgetDraft)) ? formatEUR(Number(budgetDraft)) : "—";

  function fieldError(key: keyof ProjectFormSubmitValues): string | undefined {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  }

  return (
    <>
      <PageTitle
        eyebrow={t("nav.projects")}
        title={mode === "create" ? t("screens.s02a.titleNew") : t("screens.s02a.titleEdit")}
      />
      <form onSubmit={handleSubmit((values) => onSubmit(values))} className="flex max-w-[680px] flex-col gap-s-5">
      {/* RULE (ADR-0014): the org unit an admin/estates_head/… creates a
          project under is fixed at creation and cannot be edited later
          (there is no `orgUnitId` in `ProjectUpdate`), so the field is only
          in the "create" form — and only rendered at all when the caller
          actually has more than one visible unit to choose between. */}
      {mode === "create" && orgUnits.length > 1 && (
        <div className="flex flex-col gap-s-1">
          <label htmlFor="pf-unit" className="text-fs-14 text-k-text">
            {tf("unit")}
          </label>
          <select
            id="pf-unit"
            {...register("orgUnitId")}
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          >
            {orgUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {locale === "en" ? u.nameEn : u.nameEl}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-s-1">
        <label htmlFor="pf-title-el" className="text-fs-14 text-k-text">
          {tf("titleEl")}
        </label>
        <input
          id="pf-title-el"
          type="text"
          {...register("titleEl")}
          aria-invalid={errors.titleEl ? "true" : undefined}
          aria-describedby={errors.titleEl ? "pf-title-el-error" : undefined}
          className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
        />
        {fieldError("titleEl") && (
          <p id="pf-title-el-error" role="alert" className="text-fs-14 text-k-red">
            {fieldError("titleEl")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-s-1">
        <label htmlFor="pf-title-en" className="text-fs-14 text-k-text">
          {tf("titleEn")}
        </label>
        <input
          id="pf-title-en"
          type="text"
          {...register("titleEn", { setValueAs: blankToNull })}
          className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
        />
      </div>

      <div className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
        <div className="flex flex-col gap-s-1">
          <label htmlFor="pf-category" className="text-fs-14 text-k-text">
            {tf("category")}
          </label>
          <select
            id="pf-category"
            {...register("category")}
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          >
            {ProjectCategory.options.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="pf-funding" className="text-fs-14 text-k-text">
            {tf("fundingSource")}
          </label>
          <select
            id="pf-funding"
            {...register("fundingSource")}
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          >
            {FundingSource.options.map((f) => (
              <option key={f} value={f}>
                {t(`fundingSources.${f}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-s-1">
        <label htmlFor="pf-budget" className="text-fs-14 text-k-text">
          {tf("approvedBudget")}
        </label>
        <div className="flex items-center gap-s-3">
          <input
            id="pf-budget"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            {...register("approvedBudget", {
              setValueAs: (value: string) => (value === "" ? NaN : Number(value)),
              onChange: (event) => setBudgetDraft(event.target.value),
            })}
            aria-invalid={errors.approvedBudget || budgetFieldError ? "true" : undefined}
            aria-describedby="pf-budget-preview"
            className="num h-11 w-[220px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
          <span id="pf-budget-preview" className="num text-fs-14 text-k-text">
            {budgetPreview}
          </span>
        </div>
        {fieldError("approvedBudget") && (
          <p role="alert" className="text-fs-14 text-k-red">
            {fieldError("approvedBudget")}
          </p>
        )}
        {/* RULE (ADR-0014, decided 19/09/2026): finance-only after APPROVED —
            the API's own 403 sentence, next to the field it is about. */}
        {budgetFieldError && (
          <p role="alert" className="text-fs-14 text-k-red">
            {budgetFieldError}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
        <div className="flex flex-col gap-s-1">
          <label htmlFor="pf-start" className="text-fs-14 text-k-text">
            {tf("plannedStart")}
          </label>
          <input
            id="pf-start"
            type="date"
            {...register("plannedStart", { setValueAs: blankToNull })}
            className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
        </div>
        <div className="flex flex-col gap-s-1">
          <label htmlFor="pf-finish" className="text-fs-14 text-k-text">
            {tf("plannedFinish")}
          </label>
          <input
            id="pf-finish"
            type="date"
            {...register("plannedFinish", { setValueAs: blankToNull })}
            aria-invalid={errors.plannedFinish ? "true" : undefined}
            aria-describedby={errors.plannedFinish ? "pf-finish-error" : undefined}
            className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
          {fieldError("plannedFinish") && (
            <p id="pf-finish-error" role="alert" className="text-fs-14 text-k-red">
              {fieldError("plannedFinish")}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
        <div className="flex flex-col gap-s-1">
          <label htmlFor="pf-year-from" className="text-fs-14 text-k-text">
            {tf("budgetYearFrom")}
          </label>
          <input
            id="pf-year-from"
            type="number"
            inputMode="numeric"
            {...register("budgetYearFrom", {
              setValueAs: (value: string) => (value === "" ? null : Number(value)),
            })}
            className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
        </div>
        <div className="flex flex-col gap-s-1">
          <label htmlFor="pf-year-to" className="text-fs-14 text-k-text">
            {tf("budgetYearTo")}
          </label>
          <input
            id="pf-year-to"
            type="number"
            inputMode="numeric"
            {...register("budgetYearTo", {
              setValueAs: (value: string) => (value === "" ? null : Number(value)),
            })}
            className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
        </div>
      </div>

      <div className="flex flex-col gap-s-1">
        <label htmlFor="pf-wbs" className="text-fs-14 text-k-text">
          {tf("sapWbs")}
        </label>
        <input
          id="pf-wbs"
          type="text"
          {...register("sapWbs", { setValueAs: blankToNull })}
          className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
        />
      </div>

      <div className="flex flex-col gap-s-1">
        <label htmlFor="pf-tender" className="text-fs-14 text-k-text">
          {tf("tenderReference")}
        </label>
        <input
          id="pf-tender"
          type="text"
          {...register("tenderReference", { setValueAs: blankToNull })}
          className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
        />
      </div>

      {apiError && (
        <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {apiError}
        </p>
      )}

      <div className="mt-s-2 flex items-center gap-s-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
        >
          {submitting && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
          <span>{submitting ? t("screens.s02a.saving") : t("buttons.save")}</span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60"
        >
          {t("buttons.cancel")}
        </button>
      </div>
      </form>
    </>
  );
}
