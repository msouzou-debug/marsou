"use client";

// S24 — R08 (ADR-0015 "Who keeps the contractor register")
//
/**
 * ContractorSheet — the right sheet for adding or editing one contractor.
 *
 * | Prop         | Type                | Notes                                                       |
 * |--------------|---------------------|------------------------------------------------------------------|
 * | open         | boolean             |                                                                    |
 * | contractor   | Contractor?         | Omit for «Προσθήκη»; pass the row for an edit.                     |
 * | isAdmin      | boolean             | RULE (ADR-0015, decided 19/09/2026): the «Αποκλεισμός» toggle only exists for an administrator — hidden entirely for `estates_head`, not shown-disabled, since a role that can never move it is never shown a control for it (`@/auth/roles`'s own convention). |
 * | saving       | boolean             |                                                                    |
 * | apiError     | string?             | e.g. `errors.blacklistAdminOnly` if the toggle were ever reachable by someone it should not be. |
 * | onClose      | () => void          |                                                                    |
 * | onSave       | (values, blacklisted?) => void | `blacklisted` only carries a value when the toggle is shown. |
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";
import { ContractorCategory, type Contractor } from "@ecapital/shared";
import { zodResolver } from "@/lib/zod-resolver";
import { ContractorFormSchema, type ContractorFormValues } from "./schema";

export interface ContractorSheetProps {
  open: boolean;
  contractor?: Contractor;
  isAdmin: boolean;
  saving?: boolean;
  apiError?: string;
  onClose: () => void;
  onSave: (values: ContractorFormValues, blacklisted?: boolean) => void;
}

function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

export function ContractorSheet({ open, contractor, isAdmin, saving = false, apiError, onClose, onSave }: ContractorSheetProps) {
  const t = useTranslations();
  const tf = useTranslations("screens.s24.fields");
  const [blacklisted, setBlacklisted] = useState(contractor?.blacklisted ?? false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ContractorFormValues>({
    resolver: zodResolver<ContractorFormValues>(ContractorFormSchema),
    defaultValues: {
      name: contractor?.name ?? "",
      vatNumber: contractor?.vatNumber ?? null,
      registrationNo: contractor?.registrationNo ?? null,
      category: contractor?.category ?? "BUILDING",
      sapVendorId: contractor?.sapVendorId ?? null,
    },
  });

  if (!open) return null;

  function fieldError(key: keyof ContractorFormValues): string | undefined {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  }

  return (
    <div
      role="dialog"
      aria-label={contractor ? t("screens.s24.titleEdit") : t("screens.s24.titleNew")}
      className="fixed inset-0 desktop:inset-y-0 desktop:left-auto desktop:right-0 desktop:w-[480px] flex flex-col bg-k-white shadow-k"
    >
      <header className="flex items-start justify-between border-b border-k-grey p-s-5">
        <h2 className="text-fs-20">{contractor ? t("screens.s24.titleEdit") : t("screens.s24.titleNew")}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="rounded-k p-s-2 text-k-text hover:bg-k-surface"
        >
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-auto p-s-5">
        <form
          onSubmit={handleSubmit((values) => onSave(values, isAdmin ? blacklisted : undefined))}
          className="flex flex-col gap-s-4"
        >
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cs-name" className="text-fs-14 text-k-text">
              {tf("name")}
            </label>
            <input
              id="cs-name"
              type="text"
              {...register("name")}
              aria-invalid={errors.name ? "true" : undefined}
              className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
            {fieldError("name") && (
              <p role="alert" className="text-fs-14 text-k-red">
                {fieldError("name")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="cs-vat" className="text-fs-14 text-k-text">
              {tf("vatNumber")}
            </label>
            <input
              id="cs-vat"
              type="text"
              {...register("vatNumber", { setValueAs: blankToNull })}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="cs-reg" className="text-fs-14 text-k-text">
              {tf("registrationNo")}
            </label>
            <input
              id="cs-reg"
              type="text"
              {...register("registrationNo", { setValueAs: blankToNull })}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="cs-category" className="text-fs-14 text-k-text">
              {tf("category")}
            </label>
            <select
              id="cs-category"
              {...register("category")}
              className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            >
              {ContractorCategory.options.map((option) => (
                <option key={option} value={option}>
                  {t(`contractorCategories.${option}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="cs-sap" className="text-fs-14 text-k-text">
              {tf("sapVendorId")}
            </label>
            <input
              id="cs-sap"
              type="text"
              {...register("sapVendorId", { setValueAs: blankToNull })}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
          </div>

          {/* RULE (ADR-0015, decided 19/09/2026): only an administrator sees
              this toggle at all. */}
          {contractor && isAdmin && (
            <div className="flex flex-col gap-s-1 rounded-k border border-k-grey p-s-3">
              <label className="flex items-center gap-s-3 text-fs-14 text-k-ink">
                <input
                  type="checkbox"
                  checked={blacklisted}
                  onChange={(e) => setBlacklisted(e.target.checked)}
                />
                {t("screens.s24.blacklistToggle")}
              </label>
              <p className="text-fs-12 text-k-text-muted">{t("screens.s24.blacklistHint")}</p>
            </div>
          )}

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
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60"
            >
              {t("buttons.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
