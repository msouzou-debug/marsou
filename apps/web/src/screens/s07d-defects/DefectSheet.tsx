"use client";

// S07d — R12, R35 (ADR-0017)
//
/**
 * DefectSheet — the row-open sheet for one defect, or the "new" form
 * (`defect` omitted).
 *
 * - no `defect` → the **new** form: description, area (optional select from
 *   the unit's own areas), the day it was found (today by default), estimated
 *   cost and risk band. Source is preset to HANDOVER and the contract id
 *   comes from the screen — neither is a field here.
 * - existing → the **read view** (UAT 25/11/2026 — the sheet used to open
 *   straight into a form, and only on Enter): every field — description,
 *   source, area, risk band, cost, funded and its project, status, who
 *   recorded it and the day it was found, the due date, and who closed it
 *   and when.
 * - «Επεξεργασία» (writers, while the defect is not CLOSED) → the
 *   `DefectUpdate` form: description, the day it was found, cost, risk band,
 *   status, and funded + a target project select that only appears once
 *   funded is checked. RULE (ADR-0017, mirrored client-side): funded with no
 *   target project is blocked before the request, with the same sentence
 *   the API's own `errors.fundedNeedsProject` gives.
 * - RULE (UAT 25/11/2026): a CLOSED defect is not edited (the API:
 *   errors.defectClosed). Writers see «Επανάνοιγμα» instead, which is the
 *   one change a closed defect takes.
 * - RULE (owner, UAT 25/11/2026): the day it was found is not after today,
 *   said under the field before the API says it again (errors.dateInFuture).
 *
 * | Prop        | Type                                    | Notes                                    |
 * |-------------|------------------------------------------|--------------------------------------------|
 * | open        | boolean                                   |                                              |
 * | defect      | Defect?                                   | Omit for the "new" form.                    |
 * | areas       | { id: string; nameEl: string }[]          | The unit's own areas, for the create form.  |
 * | projects    | { id: string; code: string; titleEl: string }[] | The unit's own projects, for «funded».|
 * | canWrite    | boolean                                   | `canWriteContracts(roles)` for this screen; false offline. |
 * | saving      | boolean?                                  |                                              |
 * | apiError    | string?                                   |                                              |
 * | onClose     | () => void                                |                                              |
 * | onCreate    | (values: DefectCreateFormValues) => void  |                                              |
 * | onUpdate    | (values) => Promise<boolean> \| void      | true on success returns the sheet to the read view. |
 * | onReopen    | () => void?                               | `PATCH { status: "OPEN" }` on a CLOSED defect. |
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import type { Defect } from "@ecapital/shared";
import { RiskBand, nicosiaDateOf } from "@ecapital/shared";
import { zodResolver } from "@/lib/zod-resolver";
import { formatDate, formatEURorDash } from "@/lib/format";
import { DefectCreateFormSchema, DefectUpdateFormSchema, type DefectCreateFormValues, type DefectUpdateFormValues } from "./schema";
import { SideSheet } from "@/components/side-sheet";

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
  onUpdate: (values: DefectUpdateFormValues) => Promise<boolean> | void;
  onReopen?: () => void;
}

// OWNER UAT 25/11/2026: the shared sheet — above the top bar and the
// table's sticky header, with «Πίσω στη λίστα», Escape and the backdrop as
// its ways out (`components/side-sheet`).
const SheetShell = SideSheet;

function updateValuesOf(defect: Defect | undefined): DefectUpdateFormValues | undefined {
  return defect
    ? {
        descriptionEl: defect.descriptionEl,
        estimatedCost: defect.estimatedCost ?? NaN,
        riskBand: defect.riskBand,
        funded: defect.funded,
        targetProjectId: defect.targetProjectId ?? "",
        status: defect.status,
        raisedOn: nicosiaDateOf(defect.raisedAt),
      }
    : undefined;
}

function Field({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-k-text">{label}</dt>
      <dd className={`text-k-ink ${mono ? "num" : ""}`}>{children}</dd>
    </div>
  );
}

export function DefectSheet({ open, defect, areas = [], projects = [], canWrite, saving = false, apiError, onClose, onCreate, onUpdate, onReopen }: DefectSheetProps) {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);
  const today = nicosiaDateOf(new Date());

  const createForm = useForm<DefectCreateFormValues>({
    resolver: zodResolver<DefectCreateFormValues>(DefectCreateFormSchema),
    defaultValues: { descriptionEl: "", areaId: "", estimatedCost: NaN, riskBand: "MODERATE", raisedOn: today },
  });

  const updateForm = useForm<DefectUpdateFormValues>({
    resolver: zodResolver<DefectUpdateFormValues>(DefectUpdateFormSchema),
    defaultValues: updateValuesOf(defect),
  });
  // A plain state mirror of the "funded" checkbox, not `updateForm.watch()` —
  // `watch()` returns a value React Compiler cannot memoize safely (the same
  // reason `useReactTable()` gets its own note in `Table.tsx`), and this
  // component only needs the value to decide whether to show the target
  // project select, not to re-run validation on every keystroke elsewhere.
  const [fundedChecked, setFundedChecked] = useState(defect?.funded ?? false);

  if (!open) return null;

  const errorBox = apiError && (
    <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
      {apiError}
    </p>
  );

  // ------------------------------------------------------------------ new --
  if (!defect) {
    const errors = createForm.formState.errors;
    return (
      <SheetShell title={t("buttons.add")} onClose={onClose}>
        <form noValidate onSubmit={createForm.handleSubmit((values) => onCreate(values))} className="flex flex-col gap-s-4">
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
            <label htmlFor="defect-raised-on" className="text-fs-14 text-k-text">
              {t("screens.s07d.fields.raisedOn")}
            </label>
            <input
              id="defect-raised-on"
              type="date"
              max={today}
              {...createForm.register("raisedOn")}
              aria-invalid={errors.raisedOn ? "true" : undefined}
              className="num h-11 w-[200px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
            {errors.raisedOn && (
              <p role="alert" className="text-fs-14 text-k-red">
                {t(errors.raisedOn.message as string)}
              </p>
            )}
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

          {errorBox}

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

  const canEdit = canWrite && defect.status !== "CLOSED";

  // ----------------------------------------------------------------- edit --
  if (editing && canEdit) {
    const errors = updateForm.formState.errors;
    return (
      <SheetShell title={t("screens.s07d.editTitle")} onClose={onClose}>
        <form
          noValidate
          onSubmit={updateForm.handleSubmit(async (values) => {
            if ((await onUpdate(values)) === true) setEditing(false);
          })}
          className="flex flex-col gap-s-4"
        >
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
            {errors.descriptionEl && (
              <p role="alert" className="text-fs-14 text-k-red">
                {t(errors.descriptionEl.message as string)}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="defect-edit-raised-on" className="text-fs-14 text-k-text">
              {t("screens.s07d.fields.raisedOn")}
            </label>
            <input
              id="defect-edit-raised-on"
              type="date"
              max={today}
              {...updateForm.register("raisedOn")}
              aria-invalid={errors.raisedOn ? "true" : undefined}
              className="num h-11 w-[200px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
            {errors.raisedOn && (
              <p role="alert" className="text-fs-14 text-k-red">
                {t(errors.raisedOn.message as string)}
              </p>
            )}
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

          {errorBox}

          <div className="mt-s-2 flex items-center gap-s-3">
            <button
              type="submit"
              disabled={saving}
              className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
              {t("buttons.save")}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60">
              {t("buttons.cancel")}
            </button>
          </div>
        </form>
      </SheetShell>
    );
  }

  // ------------------------------------------------------------ read view --
  const areaName = defect.areaId ? (areas.find((a) => a.id === defect.areaId)?.nameEl ?? defect.areaId) : t("common.notAvailable");
  const project = defect.targetProjectId ? projects.find((p) => p.id === defect.targetProjectId) : undefined;
  const fundedText = defect.funded
    ? `${t("common.yes")}${project ? ` · ${project.code} · ${project.titleEl}` : ""}`
    : t("common.no");

  return (
    <SheetShell title={defect.descriptionEl} onClose={onClose}>
      <dl className="grid gap-s-3 text-fs-14">
        <Field label={t("screens.s07d.fields.description")}>
          <span className="whitespace-pre-line">{defect.descriptionEl}</span>
        </Field>
        <Field label={t("screens.s07d.fields.source")}>{t(`defectSources.${defect.source}`)}</Field>
        <Field label={t("screens.s07d.fields.area")}>{areaName}</Field>
        <Field label={t("screens.s07d.fields.riskBand")}>{t(`riskBands.${defect.riskBand}`)}</Field>
        <Field label={t("screens.s07d.fields.estimatedCost")} mono>
          {formatEURorDash(defect.estimatedCost)}
        </Field>
        <Field label={t("screens.s07d.fields.funded")}>{fundedText}</Field>
        <Field label={t("screens.s07d.fields.status")}>{t(`defectStatus.${defect.status}`)}</Field>
        <Field label={t("screens.s07d.fields.raisedBy")}>{defect.raisedByName}</Field>
        <Field label={t("screens.s07d.fields.raisedOn")} mono>
          {formatDate(defect.raisedAt)}
        </Field>
        <Field label={t("screens.s07d.fields.dueDate")} mono>
          {defect.dueDate ? formatDate(defect.dueDate) : t("common.notAvailable")}
        </Field>
        {defect.closedAt && (
          <Field label={t("screens.s07d.fields.closed")}>
            {defect.closedByName ?? t("common.notAvailable")} · <span className="num">{formatDate(defect.closedAt)}</span>
          </Field>
        )}
      </dl>

      {canEdit && (
        <button
          type="button"
          onClick={() => {
            updateForm.reset(updateValuesOf(defect));
            setFundedChecked(defect.funded);
            setEditing(true);
          }}
          disabled={saving}
          className="mt-s-4 h-11 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
        >
          {t("buttons.edit")}
        </button>
      )}

      {defect.status === "CLOSED" && canWrite && (
        <>
          <p className="mt-s-4 text-fs-14 text-k-text">{t("screens.s07d.closedNoEdit")}</p>
          {onReopen && (
            <button
              type="button"
              onClick={onReopen}
              disabled={saving}
              className="mt-s-3 h-11 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
            >
              {t("screens.s07d.reopen")}
            </button>
          )}
        </>
      )}

      {apiError && <div className="mt-s-4">{errorBox}</div>}
    </SheetShell>
  );
}
