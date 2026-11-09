"use client";

// S07i — ADR-0035
//
// The add and edit panel for one claim.
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { ClaimDirection, ClaimStage, type ContractClaim } from "@ecapital/shared";
import { zodResolver } from "@/lib/zod-resolver";
import { ClaimFormSchema, type ClaimFormValues } from "./schema";

export interface ClaimFormProps {
  claim?: ContractClaim;
  saving: boolean;
  apiError?: string;
  onSave: (values: ClaimFormValues) => void;
  onCancel: () => void;
}

const INPUT = "h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink";

export function ClaimForm({ claim, saving, apiError, onSave, onCancel }: ClaimFormProps) {
  const t = useTranslations();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClaimFormValues>({
    resolver: zodResolver<ClaimFormValues>(ClaimFormSchema),
    defaultValues: {
      direction: claim?.direction ?? "BY_CONTRACTOR",
      titleEl: claim?.titleEl ?? "",
      amount: claim?.amount ?? (undefined as unknown as number),
      stage: claim?.stage ?? "NOTIFIED",
      notifiedAt: claim?.notifiedAt ?? "",
      legalAdvisorEl: claim?.legalAdvisorEl ?? "",
      contingentLiability: claim?.contingentLiability ?? false,
      notesEl: claim?.notesEl ?? "",
    },
  });
  const P = "screens.s07i.fields";
  const err = (key: keyof ClaimFormValues): string | undefined => {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  };
  const title = claim ? t("screens.s07i.editTitle") : t("screens.s07i.addTitle");

  return (
    <section role="dialog" aria-label={title} className="mb-s-6 max-w-[640px] rounded-k border border-k-grey bg-k-white p-s-5 shadow-k">
      <h2 className="text-fs-20">{title}</h2>
      <form onSubmit={handleSubmit((values) => onSave(values))} className="mt-s-4 flex flex-col gap-s-4">
        <div className="grid gap-s-4 tablet:grid-cols-2">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cl-direction" className="text-fs-14 text-k-text">{t(`${P}.direction`)}</label>
            <select id="cl-direction" {...register("direction")} className={INPUT}>
              {ClaimDirection.options.map((o) => (
                <option key={o} value={o}>{t(`claimDirection.${o}`)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cl-stage" className="text-fs-14 text-k-text">{t(`${P}.stage`)}</label>
            <select id="cl-stage" {...register("stage")} className={INPUT}>
              {ClaimStage.options.map((o) => (
                <option key={o} value={o}>{t(`claimStage.${o}`)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-s-1">
          <label htmlFor="cl-title" className="text-fs-14 text-k-text">{t(`${P}.title`)}</label>
          <input id="cl-title" {...register("titleEl")} aria-invalid={errors.titleEl ? "true" : undefined} className={INPUT} />
          {err("titleEl") && <p role="alert" className="text-fs-14 text-k-red">{err("titleEl")}</p>}
        </div>
        <div className="grid gap-s-4 tablet:grid-cols-2">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cl-amount" className="text-fs-14 text-k-text">{t(`${P}.amount`)}</label>
            <input
              id="cl-amount"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              {...register("amount", { setValueAs: (value: string) => (value === "" || value == null ? NaN : Number(value)) })}
              aria-invalid={errors.amount ? "true" : undefined}
              className={`num ${INPUT}`}
            />
            {err("amount") && <p role="alert" className="text-fs-14 text-k-red">{err("amount")}</p>}
          </div>
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cl-notified" className="text-fs-14 text-k-text">{t(`${P}.notifiedAt`)}</label>
            <input id="cl-notified" type="date" {...register("notifiedAt")} className={INPUT} />
          </div>
        </div>
        <div className="flex flex-col gap-s-1">
          <label htmlFor="cl-advisor" className="text-fs-14 text-k-text">{t(`${P}.legalAdvisor`)}</label>
          <input id="cl-advisor" {...register("legalAdvisorEl")} className={INPUT} />
        </div>
        <div className="flex flex-col gap-s-1">
          <label className="flex items-center gap-s-2 text-fs-14 text-k-ink">
            <input type="checkbox" {...register("contingentLiability")} />
            {t(`${P}.contingent`)}
          </label>
          <p className="text-fs-12 text-k-text">{t(`${P}.contingentHint`)}</p>
        </div>
        <div className="flex flex-col gap-s-1">
          <label htmlFor="cl-notes" className="text-fs-14 text-k-text">{t(`${P}.notes`)}</label>
          <textarea id="cl-notes" rows={3} {...register("notesEl")} className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink" />
        </div>
        {apiError && (
          <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">{apiError}</p>
        )}
        <div className="flex flex-wrap items-center gap-s-3">
          <button
            type="submit"
            disabled={saving}
            className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
          >
            {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
            {t("buttons.save")}
          </button>
          <button type="button" onClick={onCancel} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text">
            {t("buttons.cancel")}
          </button>
        </div>
      </form>
    </section>
  );
}
