"use client";

// S07a — R08
//
/**
 * ContractForm — the pure screen body: create at
 * `/projects/[id]/contracts/new`, edit at `/contracts/[id]/edit` (same
 * Screen/pure split and the same `zodResolver` adapter as S02a's own form —
 * see that screen's header comment for why there is no `@hookform/resolvers`
 * dependency here).
 *
 * | Prop             | Type                    | Notes                                                          |
 * |------------------|-------------------------|--------------------------------------------------------------------|
 * | mode             | "create" \| "edit"      | Hides the Ανάδοχος select and shows the Αρχική αξία as read-only text in "edit" (see the field-level RULE below). |
 * | contractors      | Contractor[]            | The register (`GET /contractors`), for the Ανάδοχος select in "create" only. |
 * | initialValues    | ContractFormValues?     | Prefills every field in "edit"; ignored in "create".              |
 * | initialContractorName / initialOriginalValue | string / number | "edit" only — the read-only facts shown where the create fields would be. |
 * | submitting       | boolean                 | Disables the form and shows the spinner in Αποθήκευση.            |
 * | apiError         | string?                 | The API's own sentence (422 errors.contractorBlacklisted / errors.projectNotAwarded, or any other failure), shown in a strip above the buttons. |
 * | onSubmit         | (values) => void        | Fired once client-side validation passes.                        |
 * | onCancel         | () => void              | Ακύρωση.                                                          |
 *
 * States: default, submitting, error (the strip above). No empty/noPermission/
 * offline, for the same reasons S02a's own `ProjectForm` gives.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { ContractType, type Contractor } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { zodResolver } from "@/lib/zod-resolver";
import { formatEUR } from "@/lib/format";
import {
  ContractCreateFormSchema,
  ContractEditFormSchema,
  type ContractCreateFormValues,
  type ContractFormValues,
} from "./schema";

export type ContractFormMode = "create" | "edit";

const EMPTY_VALUES: ContractFormValues = {
  contractNo: "",
  type: "LUMP_SUM",
  awardDate: "",
  startDate: null,
  completionDate: null,
  retentionPct: 5,
  performanceBondValue: null,
  bondExpiry: null,
  liquidatedDamagesPerDay: null,
  defectsLiabilityMonths: 12,
  sapPoNumber: null,
  emapRef: null,
};

export interface ContractFormProps {
  mode: ContractFormMode;
  contractors?: Contractor[];
  initialValues?: ContractFormValues;
  initialContractorName?: string;
  initialOriginalValue?: number;
  submitting: boolean;
  apiError?: string;
  onSubmit: (values: ContractCreateFormValues) => void;
  onCancel: () => void;
}

function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

export function ContractForm({
  mode,
  contractors = [],
  initialValues,
  initialContractorName,
  initialOriginalValue,
  submitting,
  apiError,
  onSubmit,
  onCancel,
}: ContractFormProps) {
  const t = useTranslations();
  const tf = useTranslations("screens.s07a.fields");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ContractCreateFormValues>({
    resolver:
      mode === "create"
        ? zodResolver<ContractCreateFormValues>(ContractCreateFormSchema)
        : zodResolver<ContractCreateFormValues>(ContractEditFormSchema),
    defaultValues: {
      contractorId: contractors.find((c) => !c.blacklisted)?.id ?? "",
      originalValue: 0,
      ...EMPTY_VALUES,
      ...initialValues,
    },
  });

  const [bondDraft, setBondDraft] = useState(() =>
    initialValues?.performanceBondValue != null ? String(initialValues.performanceBondValue) : "",
  );
  const bondPreview = bondDraft === "" ? "—" : Number.isFinite(Number(bondDraft)) ? formatEUR(Number(bondDraft)) : "—";

  function fieldError(key: keyof ContractCreateFormValues): string | undefined {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  }

  return (
    <>
      <PageTitle
        eyebrow={t("nav.contracts")}
        title={mode === "create" ? t("screens.s07a.titleNew") : t("screens.s07a.titleEdit")}
      />
      <form onSubmit={handleSubmit((values) => onSubmit(values))} className="flex max-w-[680px] flex-col gap-s-5">
        {mode === "create" ? (
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-contractor" className="text-fs-14 text-k-text">
              {tf("contractor")}
            </label>
            <select
              id="cf-contractor"
              {...register("contractorId")}
              aria-invalid={errors.contractorId ? "true" : undefined}
              className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            >
              {contractors.map((contractor) => (
                <option
                  key={contractor.id}
                  value={contractor.id}
                  disabled={contractor.blacklisted}
                  title={contractor.blacklisted ? t("screens.s07a.contractorBlacklistedTitle") : undefined}
                >
                  {contractor.name}
                  {contractor.blacklisted ? ` — ${t("screens.s24.blacklistedChip")}` : ""}
                </option>
              ))}
            </select>
            {fieldError("contractorId") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("contractorId")}
              </p>
            )}
          </div>
        ) : (
          // RULE (ADR-0015): the contractor cannot change after the contract
          // exists — shown as a fact, not a disabled input, so it never
          // looks like a control someone could try to use.
          <div className="flex flex-col gap-s-1">
            <span className="text-fs-14 text-k-text">{tf("contractor")}</span>
            <span className="text-fs-16 text-k-ink">{initialContractorName}</span>
            <p className="text-fs-12 text-k-text-muted">{t("screens.s07a.contractorReadOnlyNote")}</p>
          </div>
        )}

        <div className="flex flex-col gap-s-1">
          <label htmlFor="cf-contract-no" className="text-fs-14 text-k-text">
            {tf("contractNo")}
          </label>
          <input
            id="cf-contract-no"
            type="text"
            {...register("contractNo")}
            aria-invalid={errors.contractNo ? "true" : undefined}
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
          {fieldError("contractNo") && (
            <p role="alert" className="text-fs-14 text-k-red">
              {fieldError("contractNo")}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-type" className="text-fs-14 text-k-text">
              {tf("type")}
            </label>
            <select
              id="cf-type"
              {...register("type")}
              className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            >
              {ContractType.options.map((option) => (
                <option key={option} value={option}>
                  {t(`contractTypes.${option}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-award-date" className="text-fs-14 text-k-text">
              {tf("awardDate")}
            </label>
            <input
              id="cf-award-date"
              type="date"
              {...register("awardDate")}
              aria-invalid={errors.awardDate ? "true" : undefined}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
            {fieldError("awardDate") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("awardDate")}
              </p>
            )}
          </div>
        </div>

        {mode === "create" ? (
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-original-value" className="text-fs-14 text-k-text">
              {tf("originalValue")}
            </label>
            <div className="flex items-center gap-s-3">
              <input
                id="cf-original-value"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                {...register("originalValue", { setValueAs: (value: string) => (value === "" ? NaN : Number(value)) })}
                aria-invalid={errors.originalValue ? "true" : undefined}
                className="num h-11 w-[220px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
              />
            </div>
            {fieldError("originalValue") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("originalValue")}
              </p>
            )}
          </div>
        ) : (
          // RULE (ADR-0015 "The commitment"): currentValue = originalValue +
          // approved variations, maintained by a database trigger — nothing
          // this form does can write originalValue once the contract exists.
          <div className="flex flex-col gap-s-1">
            <span className="text-fs-14 text-k-text">{tf("originalValue")}</span>
            <span className="num text-fs-16 text-k-ink">
              {initialOriginalValue !== undefined ? formatEUR(initialOriginalValue) : "—"}
            </span>
            <p className="text-fs-12 text-k-text-muted">{t("screens.s07a.originalValueReadOnlyNote")}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-start" className="text-fs-14 text-k-text">
              {tf("startDate")}
            </label>
            <input
              id="cf-start"
              type="date"
              {...register("startDate", { setValueAs: blankToNull })}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
          </div>
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-completion" className="text-fs-14 text-k-text">
              {tf("completionDate")}
            </label>
            <input
              id="cf-completion"
              type="date"
              {...register("completionDate", { setValueAs: blankToNull })}
              aria-invalid={errors.completionDate ? "true" : undefined}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
            {fieldError("completionDate") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("completionDate")}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="cf-retention" className="text-fs-14 text-k-text">
            {tf("retentionPct")}
          </label>
          <input
            id="cf-retention"
            type="number"
            step="0.1"
            min="0"
            max="100"
            inputMode="decimal"
            {...register("retentionPct", { setValueAs: (value: string) => (value === "" ? NaN : Number(value)) })}
            aria-invalid={errors.retentionPct ? "true" : undefined}
            className="num h-11 w-[160px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
          {fieldError("retentionPct") && (
            <p role="alert" className="text-fs-14 text-k-red">
              {fieldError("retentionPct")}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-bond" className="text-fs-14 text-k-text">
              {tf("performanceBondValue")}
            </label>
            <div className="flex items-center gap-s-3">
              <input
                id="cf-bond"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                {...register("performanceBondValue", {
                  setValueAs: (value: string) => (value === "" ? null : Number(value)),
                  onChange: (event) => setBondDraft(event.target.value),
                })}
                aria-invalid={errors.performanceBondValue ? "true" : undefined}
                className="num h-11 w-[220px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
              />
              <span className="num text-fs-14 text-k-text">{bondPreview}</span>
            </div>
          </div>
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-bond-expiry" className="text-fs-14 text-k-text">
              {tf("bondExpiry")}
            </label>
            <input
              id="cf-bond-expiry"
              type="date"
              {...register("bondExpiry", { setValueAs: blankToNull })}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-s-4 tablet:grid-cols-2">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-lds" className="text-fs-14 text-k-text">
              {tf("liquidatedDamagesPerDay")}
            </label>
            <input
              id="cf-lds"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              {...register("liquidatedDamagesPerDay", {
                setValueAs: (value: string) => (value === "" ? null : Number(value)),
              })}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
          </div>
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-dlp" className="text-fs-14 text-k-text">
              {tf("defectsLiabilityMonths")}
            </label>
            <input
              id="cf-dlp"
              type="number"
              step="1"
              min="0"
              inputMode="numeric"
              {...register("defectsLiabilityMonths", {
                setValueAs: (value: string) => (value === "" ? NaN : Number(value)),
              })}
              aria-invalid={errors.defectsLiabilityMonths ? "true" : undefined}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
            {fieldError("defectsLiabilityMonths") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("defectsLiabilityMonths")}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-s-4 desktop:grid-cols-2">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-sap" className="text-fs-14 text-k-text">
              {tf("sapPoNumber")}
            </label>
            <input
              id="cf-sap"
              type="text"
              {...register("sapPoNumber", { setValueAs: blankToNull })}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
          </div>

          {/* ADR-0019 §4: fill this in and S07 offers «Άνοιγμα στο eMAP». The
              hint carries the format, because CON-2026-0042 is not something
              anybody guesses. */}
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cf-emap" className="text-fs-14 text-k-text">
              {tf("emapRef")}
            </label>
            <input
              id="cf-emap"
              type="text"
              placeholder="CON-2026-0042"
              {...register("emapRef", { setValueAs: blankToNull })}
              aria-invalid={errors.emapRef ? "true" : undefined}
              aria-describedby="cf-emap-hint"
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
            <p id="cf-emap-hint" className="text-fs-14 text-k-text">
              {tf("emapRefHint")}
            </p>
            {fieldError("emapRef") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("emapRef")}
              </p>
            )}
          </div>
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
            <span>{submitting ? t("screens.s07a.saving") : t("buttons.save")}</span>
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
