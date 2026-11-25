"use client";

// S09 — R11
//
/**
 * CertificateForm — the pure S09 «Νέα πιστοποίηση» form: period from/to,
 * work done (cumulative) and materials on site. Retention, previous
 * certified and net payable are never typed here — the API derives them
 * (contract `PaymentCert`), so they only ever appear read-only on the
 * detail page once the certificate exists.
 *
 * | Prop      | Type                          | Notes                                    |
 * |-----------|-------------------------------|----------------------------------------------|
 * | contractNo| string?                        | Header eyebrow.                              |
 * | delay     | ContractDelay?                 | ADR-0035: when `totalAmount > 0`, an info notice above the form — never an input; finance withholds the penalty. |
 * | contractVatRate | VatRate?                 | ADR-0038: the «Συντελεστής ΦΠΑ» default. |
 * | retentionPct / previousCertified | number? | ADR-0038: for the live net payable, VAT and gross (an estimate; the API's figure is stored). |
 * | saving    | boolean                        |                                               |
 * | apiError  | string?                        |                                               |
 * | onSave    | (values) => void               |                                               |
 * | onCancel  | () => void                     |                                               |
 */
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { DEFAULT_VAT_RATE, type ContractDelay, type VatRate } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { VatRateSelect, VatSummary } from "@/components/vat-fields";
import { formatEUR } from "@/lib/format";
import { zodResolver } from "@/lib/zod-resolver";
import { CertificateFormSchema, estimatedNetPayable, type CertificateFormValues } from "./schema";

export interface CertificateFormProps {
  contractId: string;
  contractNo?: string;
  /** ADR-0035: the contract's delay figures; a notice shows when a penalty is accruing. */
  delay?: ContractDelay;
  /** ADR-0038: the default «Συντελεστής ΦΠΑ»; 19 % until the contract has loaded. */
  contractVatRate?: VatRate;
  /** ADR-0038: for the live net payable; the preview shows «—» without them. */
  retentionPct?: number;
  previousCertified?: number;
  saving?: boolean;
  apiError?: string;
  onSave: (values: CertificateFormValues) => void;
  onCancel: () => void;
}

export function CertificateForm({
  contractNo,
  delay,
  contractVatRate,
  retentionPct,
  previousCertified,
  saving = false,
  apiError,
  onSave,
  onCancel,
}: CertificateFormProps) {
  const t = useTranslations();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getFieldState,
    formState: { errors },
  } = useForm<CertificateFormValues>({
    resolver: zodResolver<CertificateFormValues>(CertificateFormSchema),
    defaultValues: {
      periodFrom: "",
      periodTo: "",
      workDoneValue: 0,
      materialsOnSite: 0,
      vatRate: contractVatRate ?? DEFAULT_VAT_RATE,
    },
  });
  // The contract arrives after the first render; its rate becomes the
  // default unless the person has already picked one.
  useEffect(() => {
    if (contractVatRate && !getFieldState("vatRate").isDirty) setValue("vatRate", contractVatRate);
  }, [contractVatRate, getFieldState, setValue]);
  const netPayable = estimatedNetPayable({
    workDoneValue: watch("workDoneValue"),
    materialsOnSite: watch("materialsOnSite"),
    retentionPct,
    previousCertified,
  });
  const vatRate = watch("vatRate");

  function fieldError(key: keyof CertificateFormValues): string | undefined {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  }

  return (
    <>
      <PageTitle eyebrow={contractNo ?? ""} title={t("screens.s09.newTitle")} />
      {delay && delay.totalAmount !== null && delay.totalAmount > 0 && (
        <p role="note" className="mb-s-4 flex max-w-[560px] items-start gap-s-2 rounded-k border border-k-amber bg-k-amber-bg px-s-3 py-s-2 text-fs-14 text-k-ink">
          {t("screens.s09.delayNotice", { amount: formatEUR(delay.totalAmount), days: delay.totalDaysLate })}
        </p>
      )}
      <form onSubmit={handleSubmit((values) => onSave(values))} className="flex max-w-[560px] flex-col gap-s-4">
        <div className="grid gap-s-4 tablet:grid-cols-2">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cert-period-from" className="text-fs-14 text-k-text">
              {t("screens.s09.fields.periodFrom")}
            </label>
            <input
              id="cert-period-from"
              type="date"
              {...register("periodFrom")}
              aria-invalid={errors.periodFrom ? "true" : undefined}
              className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
            />
            {fieldError("periodFrom") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("periodFrom")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="cert-period-to" className="text-fs-14 text-k-text">
              {t("screens.s09.fields.periodTo")}
            </label>
            <input
              id="cert-period-to"
              type="date"
              {...register("periodTo")}
              aria-invalid={errors.periodTo ? "true" : undefined}
              className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
            />
            {fieldError("periodTo") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("periodTo")}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="cert-work-done" className="text-fs-14 text-k-text">
            {t("screens.s09.fields.workDoneValue")}
          </label>
          <input
            id="cert-work-done"
            type="number"
            step="0.01"
            inputMode="decimal"
            {...register("workDoneValue", { setValueAs: (v: string) => (v === "" ? NaN : Number(v)) })}
            aria-invalid={errors.workDoneValue ? "true" : undefined}
            className="num h-11 w-[240px] rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
          />
          {fieldError("workDoneValue") && (
            <p role="alert" className="text-fs-14 text-k-red">
              {fieldError("workDoneValue")}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="cert-materials" className="text-fs-14 text-k-text">
            {t("screens.s09.fields.materialsOnSite")}
          </label>
          <input
            id="cert-materials"
            type="number"
            step="0.01"
            inputMode="decimal"
            {...register("materialsOnSite", { setValueAs: (v: string) => (v === "" ? NaN : Number(v)) })}
            aria-invalid={errors.materialsOnSite ? "true" : undefined}
            className="num h-11 w-[240px] rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
          />
          {fieldError("materialsOnSite") && (
            <p role="alert" className="text-fs-14 text-k-red">
              {fieldError("materialsOnSite")}
            </p>
          )}
        </div>

        {/* RULE (ADR-0038): the certificate certifies NET work; VAT is put
            on its net payable at the «Συντελεστής ΦΠΑ» (the contract's by
            default), and the gross is what finance pays. */}
        <div className="flex flex-col gap-s-2">
          <VatRateSelect id="cert-vat-rate" {...register("vatRate")} />
          <dl className="flex gap-s-2 text-fs-14 text-k-text">
            <dt>{t("screens.s09.netPayableEstimate")}</dt>
            <dd className="num text-k-ink" data-testid="cert-net-payable">
              {netPayable === null ? "—" : formatEUR(netPayable)}
            </dd>
          </dl>
          <VatSummary net={netPayable} rate={vatRate} />
        </div>

        {apiError && (
          <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
            {apiError}
          </p>
        )}

        <div className="mt-s-2 flex items-center gap-s-3">
          <button
            type="submit"
            disabled={saving}
            className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
          >
            {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
            {t("buttons.save")}
          </button>
          <button type="button" onClick={onCancel} disabled={saving} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60">
            {t("buttons.cancel")}
          </button>
        </div>
      </form>
    </>
  );
}
