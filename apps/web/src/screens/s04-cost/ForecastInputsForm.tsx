"use client";

// S04 — R16
//
/**
 * ForecastInputsForm — the «Παράμετροι πρόβλεψης» inline form below the cost
 * table (build brief §5 S04). Not a sheet or a dialog: it sits on the page,
 * always visible, either as an editable form or — for a caller who is not
 * project_engineer/estates_head/admin (`canSetForecastInputs`) — as a
 * read-only summary of the same three facts, with a one-line reason instead
 * of the controls.
 *
 * | Prop     | Type                | Notes                                                     |
 * |----------|---------------------|--------------------------------------------------------------|
 * | values   | ForecastInputs      | The project's current inputs.                                 |
 * | canEdit  | boolean             | `canSetForecastInputs(roles)`.                                 |
 * | saving   | boolean             |                                                                |
 * | apiError | string?             |                                                                |
 * | onSave   | (values) => void    | `PUT /projects/:id/cost/forecast-inputs`; the caller recalculates and refetches `ProjectCost`. |
 *
 * State: default only — the form's own values come from the already-loaded
 * `ProjectCost` (the screen's loading/error/offline states cover the page
 * as a whole, same reasoning `WarningStrip`'s header comment gives).
 */
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import type { ForecastInputs } from "@ecapital/shared";
import { zodResolver } from "@/lib/zod-resolver";
import { formatEUR, formatPct } from "@/lib/format";
import { ForecastInputsFormSchema, type ForecastInputsFormValues } from "./schema";

export interface ForecastInputsFormProps {
  values: ForecastInputs;
  canEdit: boolean;
  saving?: boolean;
  apiError?: string;
  onSave: (values: ForecastInputsFormValues) => void;
}

export function ForecastInputsForm({ values, canEdit, saving = false, apiError, onSave }: ForecastInputsFormProps) {
  const t = useTranslations();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ForecastInputsFormValues>({
    resolver: zodResolver<ForecastInputsFormValues>(ForecastInputsFormSchema),
    defaultValues: {
      contingency: values.contingency,
      pendingVariationWeight: values.pendingVariationWeight,
      contingencyNoteEl: values.contingencyNoteEl ?? "",
    },
  });

  // Keep the form in step when the caller refetches after a save elsewhere
  // (e.g. after a variation approval recalculates the forecast).
  useEffect(() => {
    reset({
      contingency: values.contingency,
      pendingVariationWeight: values.pendingVariationWeight,
      contingencyNoteEl: values.contingencyNoteEl ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.contingency, values.pendingVariationWeight, values.contingencyNoteEl]);

  function fieldError(key: keyof ForecastInputsFormValues): string | undefined {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  }

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s04.forecastInputs.title")}</h2>

      {!canEdit ? (
        <>
          <dl className="mt-s-3 grid grid-cols-2 gap-s-4 tablet:grid-cols-3">
            <div>
              <dt className="text-fs-14 text-k-text">{t("screens.s04.forecastInputs.contingency")}</dt>
              <dd className="num text-fs-16 text-k-ink">{formatEUR(values.contingency)}</dd>
            </div>
            <div>
              <dt className="text-fs-14 text-k-text">{t("screens.s04.forecastInputs.pendingVariationWeight")}</dt>
              <dd className="num text-fs-16 text-k-ink">{formatPct(values.pendingVariationWeight * 100)}</dd>
            </div>
            {values.contingencyNoteEl && (
              <div>
                <dt className="text-fs-14 text-k-text">{t("screens.s04.forecastInputs.note")}</dt>
                <dd className="text-fs-16 text-k-ink">{values.contingencyNoteEl}</dd>
              </div>
            )}
          </dl>
          <p className="mt-s-3 text-fs-12 text-k-text-muted">{t("screens.s04.forecastInputs.readOnlyHint")}</p>
        </>
      ) : (
        <form
          onSubmit={handleSubmit((formValues) => onSave(formValues))}
          className="mt-s-3 grid gap-s-4 tablet:grid-cols-3"
        >
          <div className="flex flex-col gap-s-1">
            <label htmlFor="fi-contingency" className="text-fs-14 text-k-text">
              {t("screens.s04.forecastInputs.contingency")}
            </label>
            <input
              id="fi-contingency"
              type="number"
              step="0.01"
              inputMode="decimal"
              {...register("contingency", { setValueAs: (v: string) => (v === "" ? NaN : Number(v)) })}
              aria-invalid={errors.contingency ? "true" : undefined}
              className="num h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
            />
            {fieldError("contingency") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("contingency")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="fi-weight" className="text-fs-14 text-k-text">
              {t("screens.s04.forecastInputs.pendingVariationWeight")}
            </label>
            <input
              id="fi-weight"
              type="number"
              step="0.05"
              min={0}
              max={1}
              inputMode="decimal"
              {...register("pendingVariationWeight", { setValueAs: (v: string) => (v === "" ? NaN : Number(v)) })}
              aria-invalid={errors.pendingVariationWeight ? "true" : undefined}
              className="num h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
            />
            <p className="text-fs-12 text-k-text-muted">{t("screens.s04.forecastInputs.pendingVariationWeightHint")}</p>
            {fieldError("pendingVariationWeight") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("pendingVariationWeight")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-s-1 tablet:col-span-3">
            <label htmlFor="fi-note" className="text-fs-14 text-k-text">
              {t("screens.s04.forecastInputs.note")}
            </label>
            <textarea
              id="fi-note"
              rows={2}
              {...register("contingencyNoteEl")}
              className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink"
            />
          </div>

          {apiError && (
            <p role="alert" className="tablet:col-span-3 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
              {apiError}
            </p>
          )}

          <div className="tablet:col-span-3">
            <button
              type="submit"
              disabled={saving}
              className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
              {t("buttons.save")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
