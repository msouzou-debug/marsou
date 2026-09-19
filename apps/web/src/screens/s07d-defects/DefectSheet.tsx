"use client";

// S07d — R12, R35 (ADR-0017)
//
/**
 * DefectSheet — the row-open sheet for one defect, or the "new" form
 * (`defect` omitted).
 *
 * - no `defect` → the **new** form: description, area (optional select from
 *   the unit's own areas), estimated cost and risk band. Source is preset to
 *   HANDOVER and the contract id comes from the screen — neither is a field
 *   here.
 * - existing → the `DefectUpdate` form: description, cost, risk band,
 *   status, and funded + a target project select that only appears once
 *   funded is checked. RULE (ADR-0017, mirrored client-side): funded with no
 *   target project is blocked before the request, with the same sentence
 *   the API's own `errors.fundedNeedsProject` gives.
 *
 * | Prop        | Type                                    | Notes                                    |
 * |-------------|------------------------------------------|--------------------------------------------|
 * | open        | boolean                                   |                                              |
 * | defect      | Defect?                                   | Omit for the "new" form.                    |
 * | areas       | { id: string; nameEl: string }[]          | The unit's own areas, for the create form.  |
 * | projects    | { id: string; code: string; titleEl: string }[] | The unit's own projects, for «funded».|
 * | canWrite    | boolean                                   | `canWriteContracts(roles)` for this screen. |
 * | saving      | boolean?                                  |                                              |
 * | apiError    | string?                                   |                                              |
 * | onClose     | () => void                                |                                              |
 * | onCreate    | (values: DefectCreateFormValues) => void  |                                              |
 * | onUpdate    | (values: DefectUpdateFormValues) => void  |                                              |
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";
import type { Defect } from "@ecapital/shared";
import { RiskBand } from "@ecapital/shared";
import { zodResolver } from "@/lib/zod-resolver";
import { DefectCreateFormSchema, DefectUpdateFormSchema, type DefectCreateFormValues, type DefectUpdateFormValues } from "./schema";

export interface DefectAreaOption {
  id: string;
  nameEl: string;
}

export interface DefectProjectOption {
  id: string;
  code: string;
  titleEl: string;
}

export interface DefectSheetProps {
  open: boolean;
  defect?: Defect;
  areas?: DefectAreaOption[];
  projects?: DefectProjectOption[];
  canWrite: boolean;
  saving?: boolean;
  apiError?: string;
  onClose: () => void;
  onCreate: (values: DefectCreateFormValues) => void;
  onUpdate: (values: DefectUpdateFormValues) => void;
}

function SheetShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useTranslations();
  return (
    <div
      role="dialog"
      aria-label={title}
      className="fixed inset-0 desktop:inset-y-0 desktop:left-auto desktop:right-0 desktop:w-[480px] flex flex-col bg-k-white shadow-k"
    >
      <header className="flex items-start justify-between border-b border-k-grey p-s-5">
        <h2 className="text-fs-20">{title}</h2>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-k p-s-2 text-k-text hover:bg-k-surface">
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>
      <div className="flex-1 overflow-auto p-s-5">{children}</div>
    </div>
  );
}

export function DefectSheet({ open, defect, areas = [], projects = [], canWrite, saving = false, apiError, onClose, onCreate, onUpdate }: DefectSheetProps) {
  const t = useTranslations();

  const createForm = useForm<DefectCreateFormValues>({
    resolver: zodResolver<DefectCreateFormValues>(DefectCreateFormSchema),
    defaultValues: { descriptionEl: "", areaId: "", estimatedCost: NaN, riskBand: "MODERATE" },
  });

  const updateForm = useForm<DefectUpdateFormValues>({
    resolver: zodResolver<DefectUpdateFormValues>(DefectUpdateFormSchema),
    defaultValues: defect
      ? {
          descriptionEl: defect.descriptionEl,
          estimatedCost: defect.estimatedCost ?? NaN,
          riskBand: defect.riskBand,
          funded: defect.funded,
          targetProjectId: defect.targetProjectId ?? "",
          status: defect.status,
        }
      : undefined,
  });
  // A plain state mirror of the "funded" checkbox, not `updateForm.watch()` —
  // `watch()` returns a value React Compiler cannot memoize safely (the same
  // reason `useReactTable()` gets its own note in `Table.tsx`), and this
  // component only needs the value to decide whether to show the target
  // project select, not to re-run validation on every keystroke elsewhere.
  const [fundedChecked, setFundedChecked] = useState(defect?.funded ?? false);

  if (!open) return null;

  // ------------------------------------------------------------------ new --
  if (!defect) {
    const errors = createForm.formState.errors;
    return (
      <SheetShell title={t("buttons.add")} onClose={onClose}>
        <form onSubmit={createForm.handleSubmit((values) => onCreate(values))} className="flex flex-col gap-s-4">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="defect-description" className="text-fs-14 text-k-text">
              {t("screens.s07d.fields.description")}
            </label>
            <textarea
              id="defect-description"
              rows={3}
              {...createForm.register("descriptionEl")}
              aria-invalid={errors.descriptionEl ? "true" : undefined}
              className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink"
            />
            {errors.descriptionEl && (
              <p role="alert" className="text-fs-14 text-k-red">
                {t(errors.descriptionEl.message as string)}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="defect-area" className="text-fs-14 text-k-text">
              {t("screens.s07d.fields.area")}
            </label>
            <select id="defect-area" {...createForm.register("areaId")} className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink">
              <option value="">{t("screens.s07d.fields.noArea")}</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.nameEl}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="defect-cost" className="text-fs-14 text-k-text">
              {t("screens.s07d.fields.estimatedCost")}
            </label>
            <input
              id="defect-cost"
              type="number"
              step="0.01"
              inputMode="decimal"
              {...createForm.register("estimatedCost", { setValueAs: (value: string) => (value === "" ? NaN : Number(value)) })}
              className="num h-11 w-[220px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="defect-band" className="text-fs-14 text-k-text">
              {t("screens.s07d.fields.riskBand")}
            </label>
            <select id="defect-band" {...createForm.register("riskBand")} className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink">
              {RiskBand.options.map((option) => (
                <option key={option} value={option}>
                  {t(`riskBands.${option}`)}
                </option>
              ))}
            </select>
          </div>

          {apiError && (
            <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
              {apiError}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="mt-s-2 flex h-11 w-fit items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
          >
            {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
            {t("buttons.save")}
          </button>
        </form>
      </SheetShell>
    );
  }

  // ------------------------------------------------------------- existing --
  const errors = updateForm.formState.errors;
  const title = defect.descriptionEl;

  if (!canWrite) {
    return (
      <SheetShell title={title} onClose={onClose}>
        <dl className="grid gap-s-3 text-fs-14">
          <div>
            <dt className="text-k-text">{t("screens.s07d.fields.riskBand")}</dt>
            <dd className="text-k-ink">{t(`riskBands.${defect.riskBand}`)}</dd>
          </div>
          <div>
            <dt className="text-k-text">{t("screens.s07d.fields.status")}</dt>
            <dd className="text-k-ink">{t(`defectStatus.${defect.status}`)}</dd>
          </div>
        </dl>
      </SheetShell>
    );
  }

  return (
    <SheetShell title={title} onClose={onClose}>
      <form onSubmit={updateForm.handleSubmit((values) => onUpdate(values))} className="flex flex-col gap-s-4">
        <div className="flex flex-col gap-s-1">
          <label htmlFor="defect-edit-description" className="text-fs-14 text-k-text">
            {t("screens.s07d.fields.description")}
          </label>
          <textarea
            id="defect-edit-description"
            rows={3}
            {...updateForm.register("descriptionEl")}
            aria-invalid={errors.descriptionEl ? "true" : undefined}
            className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink"
          />
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="defect-edit-cost" className="text-fs-14 text-k-text">
            {t("screens.s07d.fields.estimatedCost")}
          </label>
          <input
            id="defect-edit-cost"
            type="number"
            step="0.01"
            inputMode="decimal"
            {...updateForm.register("estimatedCost", { setValueAs: (value: string) => (value === "" ? NaN : Number(value)) })}
            className="num h-11 w-[220px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="defect-edit-band" className="text-fs-14 text-k-text">
            {t("screens.s07d.fields.riskBand")}
          </label>
          <select id="defect-edit-band" {...updateForm.register("riskBand")} className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink">
            {RiskBand.options.map((option) => (
              <option key={option} value={option}>
                {t(`riskBands.${option}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="defect-edit-status" className="text-fs-14 text-k-text">
            {t("screens.s07d.fields.status")}
          </label>
          <select id="defect-edit-status" {...updateForm.register("status")} className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink">
            {(["OPEN", "IN_PROGRESS", "CLOSED"] as const).map((option) => (
              <option key={option} value={option}>
                {t(`defectStatus.${option}`)}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-s-2 text-fs-14 text-k-ink">
          <input
            type="checkbox"
            checked={fundedChecked}
            onChange={(event) => {
              setFundedChecked(event.target.checked);
              updateForm.setValue("funded", event.target.checked);
            }}
          />
          {t("screens.s07d.fields.funded")}
        </label>

        {/* RULE (ADR-0017, mirrored client-side): the target project select
            only matters — and is only required — once funded is checked. */}
        {fundedChecked && (
          <div className="flex flex-col gap-s-1">
            <label htmlFor="defect-edit-target" className="text-fs-14 text-k-text">
              {t("screens.s07d.fields.targetProject")}
            </label>
            <select
              id="defect-edit-target"
              {...updateForm.register("targetProjectId")}
              aria-invalid={errors.targetProjectId ? "true" : undefined}
              className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            >
              <option value="">{t("screens.s07d.fields.noProject")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} · {project.titleEl}
                </option>
              ))}
            </select>
            {errors.targetProjectId && (
              <p role="alert" className="text-fs-14 text-k-red">
                {t(errors.targetProjectId.message as string)}
              </p>
            )}
          </div>
        )}

        {apiError && (
          <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
            {apiError}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="mt-s-2 flex h-11 w-fit items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
        >
          {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
          {t("buttons.save")}
        </button>
      </form>
    </SheetShell>
  );
}
