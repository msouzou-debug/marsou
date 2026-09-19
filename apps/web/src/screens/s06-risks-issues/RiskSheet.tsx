"use client";

// S06 — R07
//
/**
 * RiskSheet — the right sheet for adding or editing one risk, same shell as
 * S24's `ContractorSheet`.
 *
 * | Prop     | Type      | Notes                                                    |
 * |----------|-----------|---------------------------------------------------------------|
 * | open     | boolean   |                                                                 |
 * | risk     | Risk?     | Omit for «Προσθήκη»; pass the row for an edit.                   |
 * | saving   | boolean   |                                                                 |
 * | apiError | string?   |                                                                 |
 * | onClose  | () => void|                                                                 |
 * | onSave   | (values: RiskFormValues) => void |                                        |
 *
 * FLAGGED (not settled by an ADR): there is no directory endpoint the web
 * app can read to pick a person for «Ιδιοκτήτης» — `ecapital.user_display_name`
 * (ADR-0014) only resolves an id to a name server-side, for display. Until a
 * directory exists, the owner field is a plain text id with a hint saying
 * so, rather than a picker this build would have to invent a source for.
 */
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";
import { RiskStatus, type Risk } from "@ecapital/shared";
import { zodResolver } from "@/lib/zod-resolver";
import { RiskFormSchema, type RiskFormValues } from "./schema";

export interface RiskSheetProps {
  open: boolean;
  risk?: Risk;
  saving?: boolean;
  apiError?: string;
  onClose: () => void;
  onSave: (values: RiskFormValues) => void;
}

function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

const LEVELS = [1, 2, 3, 4, 5];

export function RiskSheet({ open, risk, saving = false, apiError, onClose, onSave }: RiskSheetProps) {
  const t = useTranslations();
  const tf = useTranslations("screens.s06.riskFields");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RiskFormValues>({
    resolver: zodResolver<RiskFormValues>(RiskFormSchema),
    defaultValues: {
      descriptionEl: risk?.descriptionEl ?? "",
      likelihood: risk?.likelihood ?? 3,
      impact: risk?.impact ?? 3,
      ownerId: risk?.ownerId ?? null,
      mitigationEl: risk?.mitigationEl ?? null,
      status: risk?.status ?? "OPEN",
    },
  });

  if (!open) return null;

  function fieldError(key: keyof RiskFormValues): string | undefined {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  }

  return (
    <div
      role="dialog"
      aria-label={risk ? t("screens.s06.editRiskTitle") : t("screens.s06.addRiskTitle")}
      className="fixed inset-0 flex flex-col bg-k-white shadow-k desktop:inset-y-0 desktop:left-auto desktop:right-0 desktop:w-[480px]"
    >
      <header className="flex items-start justify-between border-b border-k-grey p-s-5">
        <h2 className="text-fs-20">{risk ? t("screens.s06.editRiskTitle") : t("screens.s06.addRiskTitle")}</h2>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-k p-s-2 text-k-text hover:bg-k-surface">
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-auto p-s-5">
        <form onSubmit={handleSubmit(onSave)} className="flex flex-col gap-s-4">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="rs-description" className="text-fs-14 text-k-text">
              {tf("description")}
            </label>
            <textarea
              id="rs-description"
              rows={3}
              {...register("descriptionEl")}
              aria-invalid={errors.descriptionEl ? "true" : undefined}
              className="w-full rounded-k border border-k-grey bg-k-white p-s-3 text-fs-16 text-k-ink"
            />
            {fieldError("descriptionEl") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("descriptionEl")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-s-3">
            <div className="flex flex-col gap-s-1">
              <label htmlFor="rs-likelihood" className="text-fs-14 text-k-text">
                {tf("likelihood")}
              </label>
              <select
                id="rs-likelihood"
                {...register("likelihood", { valueAsNumber: true })}
                className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink num"
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-s-1">
              <label htmlFor="rs-impact" className="text-fs-14 text-k-text">
                {tf("impact")}
              </label>
              <select
                id="rs-impact"
                {...register("impact", { valueAsNumber: true })}
                className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink num"
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="rs-owner" className="text-fs-14 text-k-text">
              {tf("owner")}
            </label>
            <input
              id="rs-owner"
              type="text"
              {...register("ownerId", { setValueAs: blankToNull })}
              className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
            <p className="text-fs-12 text-k-text-muted">{tf("ownerHint")}</p>
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="rs-mitigation" className="text-fs-14 text-k-text">
              {tf("mitigation")}
            </label>
            <textarea
              id="rs-mitigation"
              rows={3}
              {...register("mitigationEl", { setValueAs: blankToNull })}
              className="w-full rounded-k border border-k-grey bg-k-white p-s-3 text-fs-16 text-k-ink"
            />
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="rs-status" className="text-fs-14 text-k-text">
              {tf("status")}
            </label>
            <select id="rs-status" {...register("status")} className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink">
              {RiskStatus.options.map((option) => (
                <option key={option} value={option}>
                  {t(`riskStatus.${option}`)}
                </option>
              ))}
            </select>
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
            <button type="button" onClick={onClose} disabled={saving} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60">
              {t("buttons.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
