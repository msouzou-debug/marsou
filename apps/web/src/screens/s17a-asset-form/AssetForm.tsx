"use client";

// S17a — R26–R30, R45
//
/**
 * AssetForm — create at `/assets/new`, edit at `/assets/[id]/edit` (M4 build
 * brief item 2). One page, grouped fields, react-hook-form bound to
 * `AssetCreateFormSchema`/`AssetEditFormSchema` (`schema.ts`) through the
 * local `zodResolver` adapter — the same pattern
 * `s02a-project-form/ProjectForm.tsx`'s header comment documents.
 *
 * DEVIATION from that pattern, flagged here rather than silently copied: the
 * Screen/pure split every other write form in this app follows would need
 * S17a's `AssetFormScreen` to hold the live selected unit, refetch four
 * different per-unit lists on every change, and hand them back down — a lot
 * of ping-pong for what is, underneath, four read-only lookups
 * (`useAreaTree`, `useProjectsForUnit`, `useContractsForUnit`, a parent-asset
 * search over `useAssets`) that only this form's own live `orgUnitId` value
 * ever needs. This component calls those hooks itself instead. It stays
 * "pure" in the sense that matters for the write path — `AssetFormScreen`
 * remains the only place that calls `apiMutate` — but not in the stricter
 * sense of holding zero query hooks. Worth a line in the hand-back summary.
 *
 * | Prop           | Type                    | Notes                                                                 |
 * |----------------|-------------------------|----------------------------------------------------------------------|
 * | mode           | "create" \| "edit"      | Hides the Μονάδα field in "edit" — the org unit never changes after the asset exists (ADR-0014's precedent). |
 * | orgUnits       | OrgUnit[]               | The caller's own visible units.                                       |
 * | defaultOrgUnitId | string?               | Preselected from the shell's unit cookie, "create" only.               |
 * | editOrgUnitId  | string?                 | Required in "edit" — the asset's own unit, fixed, drives the area/project/contract lookups. |
 * | initialValues  | AssetFormValues?        | Prefills every field in "edit"; ignored in "create".                   |
 * | initialParentTag / initialSourceProjectLabel / initialSourceContractLabel | string? | "edit" only — so the picked-but-unsearched selections still show a label instead of a bare id. |
 * | readOnly       | boolean                 | RULE (build brief item 2): a technician sees every field disabled — the form has no submit control at all in this mode. |
 * | submitting     | boolean                 |                                                                        |
 * | apiError       | string?                 |                                                                        |
 * | onSubmit       | (values) => void        |                                                                        |
 * | onCancel       | () => void              |                                                                        |
 *
 * States: default, submitting, error — same reasoning `ProjectForm`'s header
 * comment gives (no empty/noPermission/offline for a write form).
 */
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocale, useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { AssetClass, PermitSystem, type OrgUnit } from "@ecapital/shared";
import { AreaPicker } from "@/components/area-picker";
import { PageTitle } from "@/components/app-shell";
import { useAreaTree, useAssets, useContractsForUnit, useProjectsForUnit } from "@/data/queries";
import type { Locale } from "@/i18n/config";
import { formatEUR } from "@/lib/format";
import { zodResolver } from "@/lib/zod-resolver";
import { AssetCreateFormSchema, AssetEditFormSchema, type AssetFormValues } from "./schema";

export type AssetFormMode = "create" | "edit";

export type AssetFormSubmitValues = AssetFormValues & { orgUnitId?: string };

const EMPTY_VALUES: AssetFormValues = {
  nameEl: "",
  assetClass: "OTHER",
  areaId: null,
  parentAssetId: null,
  manufacturer: null,
  model: null,
  serialNo: null,
  installedDate: null,
  commissionedDate: null,
  sourceProjectId: null,
  sourceContractId: null,
  capitalCost: null,
  warrantyEnd: null,
  expectedLifeYears: null,
  replacementYear: null,
  replacementCostEst: null,
  criticality: 3,
  system: null,
  servesAreaIds: [],
};

const CRITICALITY_OPTIONS = [1, 2, 3, 4, 5] as const;
const SYSTEM_OPTIONS: PermitSystem[] = ["ELECTRICAL", "HVAC", "MEDICAL_GAS", "WATER", "FIRE", "IT", "STEAM", "DRAINAGE"];

function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}
/**
 * RULE: react-hook-form runs `setValueAs` on the default value at
 * registration too, and `Number(null)` is 0 — which is how an untouched
 * «Αναμενόμενη ωφέλιμη ζωή» once reached the API as 0 years and was refused.
 * Blank, null and undefined are all "not given".
 */
export function blankToNullNumber(value: string | number | null | undefined): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isNaN(n) ? null : n;
}

export interface AssetFormProps {
  mode: AssetFormMode;
  orgUnits: OrgUnit[];
  defaultOrgUnitId?: string;
  editOrgUnitId?: string;
  initialValues?: AssetFormValues;
  initialParentTag?: string;
  initialSourceProjectLabel?: string;
  initialSourceContractLabel?: string;
  readOnly: boolean;
  submitting: boolean;
  apiError?: string;
  onSubmit: (values: AssetFormSubmitValues) => void;
  onCancel: () => void;
}

export function AssetForm({
  mode,
  orgUnits,
  defaultOrgUnitId,
  editOrgUnitId,
  initialValues,
  initialParentTag,
  initialSourceProjectLabel,
  initialSourceContractLabel,
  readOnly,
  submitting,
  apiError,
  onSubmit,
  onCancel,
}: AssetFormProps) {
  const t = useTranslations();
  const tf = useTranslations("screens.s17a.fields");
  const locale = useLocale() as Locale;

  const resolvedDefaultUnit = useMemo(
    () => (defaultOrgUnitId && orgUnits.some((u) => u.id === defaultOrgUnitId) ? defaultOrgUnitId : orgUnits[0]?.id),
    [defaultOrgUnitId, orgUnits],
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AssetFormSubmitValues>({
    resolver: mode === "create" ? zodResolver<AssetFormSubmitValues>(AssetCreateFormSchema) : zodResolver<AssetFormSubmitValues>(AssetEditFormSchema),
    defaultValues: { orgUnitId: resolvedDefaultUnit ?? "", ...EMPTY_VALUES, ...initialValues },
  });

  const liveOrgUnitId = mode === "create" ? watch("orgUnitId") : (editOrgUnitId ?? "");
  const areaId = watch("areaId");
  const parentAssetId = watch("parentAssetId");
  const sourceProjectId = watch("sourceProjectId");
  const sourceContractId = watch("sourceContractId");
  const system = watch("system");
  const servesAreaIds = watch("servesAreaIds") ?? [];

  const { data: areaTree } = useAreaTree(liveOrgUnitId || "");
  const { data: projects } = useProjectsForUnit(liveOrgUnitId || "");
  const { data: contracts } = useContractsForUnit(liveOrgUnitId || "");

  const [parentSearch, setParentSearch] = useState("");
  const { data: parentResults } = useAssets({
    orgUnitId: liveOrgUnitId || undefined,
    q: parentSearch,
    sort: "tag",
    dir: "asc",
    page: 1,
    pageSize: 10,
  });

  const [capitalCostDraft, setCapitalCostDraft] = useState(() => (initialValues?.capitalCost != null ? String(initialValues.capitalCost) : ""));
  const [replacementCostDraft, setReplacementCostDraft] = useState(() =>
    initialValues?.replacementCostEst != null ? String(initialValues.replacementCostEst) : "",
  );

  function fieldError(key: keyof AssetFormSubmitValues): string | undefined {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  }

  const parentLabel = parentAssetId
    ? (parentResults?.items.find((a) => a.id === parentAssetId)?.tag ?? initialParentTag ?? parentAssetId)
    : null;

  const fieldset = "flex flex-col gap-s-1";
  const input = "h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink disabled:bg-k-surface disabled:text-k-text";

  return (
    <>
      <PageTitle eyebrow={t("nav.assets")} title={mode === "create" ? t("screens.s17a.titleNew") : t("screens.s17a.titleEdit")} />

      {readOnly && <p className="mb-s-4 max-w-[680px] text-fs-14 text-k-text">{t("screens.s17a.readOnlyNotice")}</p>}

      <form
        onSubmit={handleSubmit((values) => onSubmit(values))}
        className="flex max-w-[680px] flex-col gap-s-6"
      >
        <fieldset disabled={readOnly} className="grid gap-s-5">
          <legend className="mb-s-2 text-fs-20 text-k-blue-deep">{t("screens.s17a.sections.identity")}</legend>

          {mode === "create" && orgUnits.length > 1 && (
            <div className={fieldset}>
              <label htmlFor="af-unit" className="text-fs-14 text-k-text">{t("common.unit")}</label>
              <select id="af-unit" {...register("orgUnitId")} className={input}>
                {orgUnits.map((u) => (
                  <option key={u.id} value={u.id}>{locale === "en" ? u.nameEn : u.nameEl}</option>
                ))}
              </select>
            </div>
          )}

          <div className={fieldset}>
            <label htmlFor="af-name" className="text-fs-14 text-k-text">{tf("nameEl")}</label>
            <input id="af-name" type="text" {...register("nameEl")} aria-invalid={errors.nameEl ? "true" : undefined} className={input} />
            {fieldError("nameEl") && <p role="alert" className="text-fs-14 text-k-red">{fieldError("nameEl")}</p>}
          </div>

          <div className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
            <div className={fieldset}>
              <label htmlFor="af-class" className="text-fs-14 text-k-text">{tf("assetClass")}</label>
              <select id="af-class" {...register("assetClass")} className={input}>
                {AssetClass.options.map((c) => (
                  <option key={c} value={c}>{t(`assetClass.${c}`)}</option>
                ))}
              </select>
            </div>
            <div className={fieldset}>
              <label htmlFor="af-system" className="text-fs-14 text-k-text">{tf("system")}</label>
              <select
                id="af-system"
                value={system ?? ""}
                onChange={(e) => setValue("system", e.target.value ? (e.target.value as PermitSystem) : null)}
                disabled={readOnly}
                className={input}
              >
                <option value="">{tf("noSystem")}</option>
                {SYSTEM_OPTIONS.map((s) => (
                  <option key={s} value={s}>{t(`permitSystem.${s}`)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className={fieldset}>
            <p className="text-fs-14 text-k-text">{tf("area")}</p>
            {areaTree ? (
              <AreaPicker
                areaTree={areaTree}
                selectedAreaIds={areaId ? [areaId] : []}
                onToggle={(id) => !readOnly && setValue("areaId", id === areaId ? null : id)}
                mode="single"
              />
            ) : (
              <p className="text-fs-14 text-k-text-muted">{t("common.loading")}</p>
            )}
          </div>

          <div className={fieldset}>
            <label htmlFor="af-parent" className="text-fs-14 text-k-text">{tf("parentAsset")}</label>
            {parentAssetId ? (
              <div className="flex items-center gap-s-3">
                <span className="font-k-mono text-k-ink">{parentLabel}</span>
                {!readOnly && (
                  <button type="button" onClick={() => setValue("parentAssetId", null)} className="text-fs-14 text-k-blue">
                    {t("buttons.cancel")}
                  </button>
                )}
              </div>
            ) : (
              <>
                <input
                  id="af-parent"
                  type="text"
                  value={parentSearch}
                  onChange={(e) => setParentSearch(e.target.value)}
                  placeholder={t("screens.s17a.parentSearchPlaceholder")}
                  disabled={readOnly}
                  className={input}
                />
                {parentSearch.trim() && (parentResults?.items.length ?? 0) > 0 && (
                  <ul className="mt-s-1 grid gap-s-1 rounded-k border border-k-grey p-s-2">
                    {parentResults?.items.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setValue("parentAssetId", a.id);
                            setParentSearch("");
                          }}
                          className="flex w-full items-center gap-s-2 text-left text-fs-14"
                        >
                          <span className="font-k-mono text-k-blue">{a.tag}</span>
                          <span className="text-k-ink">{a.nameEl}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {system && (
            <div className={fieldset}>
              <p className="text-fs-14 text-k-text">{tf("servesAreaIds")}</p>
              {areaTree ? (
                <AreaPicker
                  areaTree={areaTree}
                  selectedAreaIds={servesAreaIds}
                  onToggle={(id) =>
                    !readOnly &&
                    setValue("servesAreaIds", servesAreaIds.includes(id) ? servesAreaIds.filter((x) => x !== id) : [...servesAreaIds, id])
                  }
                />
              ) : (
                <p className="text-fs-14 text-k-text-muted">{t("common.loading")}</p>
              )}
            </div>
          )}
        </fieldset>

        <fieldset disabled={readOnly} className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
          <legend className="mb-s-2 text-fs-20 text-k-blue-deep">{t("screens.s17a.sections.sourcing")}</legend>
          <div className={fieldset}>
            <label htmlFor="af-manufacturer" className="text-fs-14 text-k-text">{tf("manufacturer")}</label>
            <input id="af-manufacturer" type="text" {...register("manufacturer", { setValueAs: blankToNull })} className={input} />
          </div>
          <div className={fieldset}>
            <label htmlFor="af-model" className="text-fs-14 text-k-text">{tf("model")}</label>
            <input id="af-model" type="text" {...register("model", { setValueAs: blankToNull })} className={input} />
          </div>
          <div className={fieldset}>
            <label htmlFor="af-serial" className="text-fs-14 text-k-text">{tf("serialNo")}</label>
            <input id="af-serial" type="text" {...register("serialNo", { setValueAs: blankToNull })} className={`num ${input}`} />
          </div>
          <div className={fieldset}>
            <label htmlFor="af-installed" className="text-fs-14 text-k-text">{tf("installedDate")}</label>
            <input id="af-installed" type="date" {...register("installedDate", { setValueAs: blankToNull })} className={`num ${input}`} />
          </div>
          <div className={fieldset}>
            <label htmlFor="af-commissioned" className="text-fs-14 text-k-text">{tf("commissionedDate")}</label>
            <input id="af-commissioned" type="date" {...register("commissionedDate", { setValueAs: blankToNull })} className={`num ${input}`} />
          </div>
          <div className={fieldset}>
            <label htmlFor="af-warranty" className="text-fs-14 text-k-text">{tf("warrantyEnd")}</label>
            <input id="af-warranty" type="date" {...register("warrantyEnd", { setValueAs: blankToNull })} className={`num ${input}`} />
          </div>
          <div className={fieldset}>
            <label htmlFor="af-project" className="text-fs-14 text-k-text">{tf("sourceProjectId")}</label>
            <select
              id="af-project"
              value={sourceProjectId ?? ""}
              onChange={(e) => setValue("sourceProjectId", e.target.value || null)}
              disabled={readOnly}
              className={input}
            >
              <option value="">{tf("noProject")}</option>
              {initialSourceProjectLabel && sourceProjectId && !projects?.items.some((p) => p.id === sourceProjectId) && (
                <option value={sourceProjectId}>{initialSourceProjectLabel}</option>
              )}
              {projects?.items.map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.titleEl}</option>
              ))}
            </select>
          </div>
          <div className={fieldset}>
            <label htmlFor="af-contract" className="text-fs-14 text-k-text">{tf("sourceContractId")}</label>
            <select
              id="af-contract"
              value={sourceContractId ?? ""}
              onChange={(e) => setValue("sourceContractId", e.target.value || null)}
              disabled={readOnly}
              className={input}
            >
              <option value="">{tf("noContract")}</option>
              {initialSourceContractLabel && sourceContractId && !contracts?.some((c) => c.id === sourceContractId) && (
                <option value={sourceContractId}>{initialSourceContractLabel}</option>
              )}
              {contracts?.map((c) => (
                <option key={c.id} value={c.id}>{c.ref} — {c.contractorName}</option>
              ))}
            </select>
          </div>
          <div className={fieldset}>
            <label htmlFor="af-capital-cost" className="text-fs-14 text-k-text">{tf("capitalCost")}</label>
            <div className="flex items-center gap-s-3">
              <input
                id="af-capital-cost"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                {...register("capitalCost", {
                  setValueAs: blankToNullNumber,
                  onChange: (e) => setCapitalCostDraft(e.target.value),
                })}
                className={`num w-[180px] ${input}`}
              />
              <span className="num text-fs-14 text-k-text">{capitalCostDraft === "" ? "—" : formatEUR(Number(capitalCostDraft))}</span>
            </div>
          </div>
        </fieldset>

        <fieldset disabled={readOnly} className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
          <legend className="mb-s-2 text-fs-20 text-k-blue-deep">{t("screens.s17a.sections.life")}</legend>
          <div className={fieldset}>
            <label htmlFor="af-life" className="text-fs-14 text-k-text">{tf("expectedLifeYears")}</label>
            <input id="af-life" type="number" inputMode="numeric" {...register("expectedLifeYears", { setValueAs: blankToNullNumber })} className={`num ${input}`} />
          </div>
          <div className={fieldset}>
            <label htmlFor="af-replacement-year" className="text-fs-14 text-k-text">{tf("replacementYear")}</label>
            <input id="af-replacement-year" type="number" inputMode="numeric" {...register("replacementYear", { setValueAs: blankToNullNumber })} className={`num ${input}`} />
          </div>
          <div className={fieldset}>
            <label htmlFor="af-replacement-cost" className="text-fs-14 text-k-text">{tf("replacementCostEst")}</label>
            <div className="flex items-center gap-s-3">
              <input
                id="af-replacement-cost"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                {...register("replacementCostEst", {
                  setValueAs: blankToNullNumber,
                  onChange: (e) => setReplacementCostDraft(e.target.value),
                })}
                className={`num w-[180px] ${input}`}
              />
              <span className="num text-fs-14 text-k-text">{replacementCostDraft === "" ? "—" : formatEUR(Number(replacementCostDraft))}</span>
            </div>
          </div>
          <div className={fieldset}>
            <label htmlFor="af-criticality" className="text-fs-14 text-k-text">{tf("criticality")}</label>
            <select id="af-criticality" {...register("criticality", { setValueAs: Number })} className={input}>
              {CRITICALITY_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <p className="text-fs-12 text-k-text">{tf("criticalityHint")}</p>
          </div>
        </fieldset>

        {apiError && (
          <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">{apiError}</p>
        )}

        {!readOnly && (
          <div className="flex items-center gap-s-3">
            <button
              type="submit"
              disabled={submitting}
              className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              {submitting && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
              <span>{submitting ? t("screens.s17a.saving") : t("buttons.save")}</span>
            </button>
            <button type="button" onClick={onCancel} disabled={submitting} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60">
              {t("buttons.cancel")}
            </button>
          </div>
        )}
        {readOnly && (
          <div>
            <button type="button" onClick={onCancel} className="h-11 rounded-k border border-k-grey px-s-5 text-fs-14 text-k-text">
              {t("common.back")}
            </button>
          </div>
        )}
      </form>
    </>
  );
}
