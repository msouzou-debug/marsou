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
 * | vendorSearch | (q: string) => Promise<EFinanceVendor[]>? | ADR-0029: `GET /efinance/vendors?q=` for the «Κωδικός SAP» picker. Omit it and the field is the plain text input it always was. |
 *
 * Owner UAT 25/11/2026: «Στοιχεία επικοινωνίας» — a contact person, an
 * e-mail and a telephone, which prefill a new RFI's recipient. A contact
 * filled from eFinance says so under the fields; changing it makes it the
 * user's own, which the eFinance sync never overwrites. No bank details.
 */
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { ContractorCategory, type Contractor, type EFinanceVendor } from "@ecapital/shared";
import { VendorPicker } from "@/components/vendor-picker";
import { zodResolver } from "@/lib/zod-resolver";
import { formatDate } from "@/lib/format";
import { ContractorFormSchema, type ContractorFormValues } from "./schema";
import { SideSheet } from "@/components/side-sheet";

export interface ContractorSheetProps {
  open: boolean;
  contractor?: Contractor;
  isAdmin: boolean;
  saving?: boolean;
  apiError?: string;
  onClose: () => void;
  onSave: (values: ContractorFormValues, blacklisted?: boolean) => void;
  vendorSearch?: (q: string) => Promise<EFinanceVendor[]>;
}

function blankToNull(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}

export function ContractorSheet({ open, contractor, isAdmin, saving = false, apiError, onClose, onSave, vendorSearch }: ContractorSheetProps) {
  const t = useTranslations();
  const tf = useTranslations("screens.s24.fields");
  const [blacklisted, setBlacklisted] = useState(contractor?.blacklisted ?? false);

  const [prefilledFromVendor, setPrefilledFromVendor] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<ContractorFormValues>({
    resolver: zodResolver<ContractorFormValues>(ContractorFormSchema),
    defaultValues: {
      name: contractor?.name ?? "",
      vatNumber: contractor?.vatNumber ?? null,
      registrationNo: contractor?.registrationNo ?? null,
      category: contractor?.category ?? "BUILDING",
      sapVendorId: contractor?.sapVendorId ?? null,
      contactName: contractor?.contactName ?? null,
      contactEmail: contractor?.contactEmail ?? null,
      contactPhone: contractor?.contactPhone ?? null,
    },
  });

  if (!open) return null;

  /**
   * Coordinator 25/11/2026 (eFinance deploy68 sends `email` and `phone`):
   * picking a vendor fills the contact e-mail and telephone from it, but only
   * a field that is empty — what is already there, typed or synced, stays.
   * The contact person is never touched. What is filled stays editable, and
   * saving it makes it the user's own (MANUAL), as any typed contact is.
   */
  function prefillContact(vendor: EFinanceVendor) {
    let filled = false;
    for (const [field, value] of [
      ["contactEmail", vendor.email],
      ["contactPhone", vendor.phone],
    ] as const) {
      if (!value || (getValues(field) ?? "").trim() !== "") continue;
      setValue(field, value, { shouldDirty: true, shouldValidate: true });
      filled = true;
    }
    setPrefilledFromVendor(filled);
  }

  function fieldError(key: keyof ContractorFormValues): string | undefined {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  }

  return (
    <SideSheet title={contractor ? t("screens.s24.titleEdit") : t("screens.s24.titleNew")} onClose={onClose}>
      <div>
        <form
          noValidate
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
            {/* ADR-0029: a search over eFinance's vendors, with the plain text
                input underneath as the fallback — what is typed is the value. */}
            <Controller
              name="sapVendorId"
              control={control}
              render={({ field }) => (
                <VendorPicker id="cs-sap" value={field.value} onChange={field.onChange} onPick={prefillContact} search={vendorSearch} />
              )}
            />
            {vendorSearch && <p className="text-fs-14 text-k-text">{t("components.vendor-picker.hint")}</p>}
          </div>

          <fieldset className="flex flex-col gap-s-3 rounded-k border border-k-grey p-s-3">
            <legend className="px-s-1 text-fs-14 font-bold text-k-blue-deep">{t("screens.s24.contactTitle")}</legend>
            <p className="text-fs-14 text-k-text">{t("screens.s24.contactHint")}</p>
            <div className="flex flex-col gap-s-1">
              <label htmlFor="cs-contact-name" className="text-fs-14 text-k-text">
                {tf("contactName")}
              </label>
              <input
                id="cs-contact-name"
                type="text"
                autoComplete="off"
                {...register("contactName", { setValueAs: blankToNull })}
                aria-invalid={errors.contactName ? "true" : undefined}
                className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
              />
              {fieldError("contactName") && (
                <p role="alert" className="text-fs-14 text-k-red">
                  {fieldError("contactName")}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-s-1">
              <label htmlFor="cs-contact-email" className="text-fs-14 text-k-text">
                {tf("contactEmail")}
              </label>
              <input
                id="cs-contact-email"
                type="email"
                autoComplete="off"
                {...register("contactEmail", { setValueAs: blankToNull })}
                aria-invalid={errors.contactEmail ? "true" : undefined}
                className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
              />
              {fieldError("contactEmail") && (
                <p role="alert" className="text-fs-14 text-k-red">
                  {fieldError("contactEmail")}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-s-1">
              <label htmlFor="cs-contact-phone" className="text-fs-14 text-k-text">
                {tf("contactPhone")}
              </label>
              <input
                id="cs-contact-phone"
                type="tel"
                autoComplete="off"
                {...register("contactPhone", { setValueAs: blankToNull })}
                aria-invalid={errors.contactPhone ? "true" : undefined}
                className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
              />
              {fieldError("contactPhone") && (
                <p role="alert" className="text-fs-14 text-k-red">
                  {fieldError("contactPhone")}
                </p>
              )}
            </div>
            {prefilledFromVendor && (
              <p role="status" className="text-fs-14 text-k-text">
                {t("screens.s24.contactFromVendor")}
              </p>
            )}
            {contractor?.contactSource === "EFINANCE" && (
              <p className="text-fs-14 text-k-text">
                {contractor.contactSyncedAt
                  ? t("screens.s24.contactFromEfinanceOn", { date: formatDate(contractor.contactSyncedAt) })
                  : t("screens.s24.contactFromEfinance")}
              </p>
            )}
          </fieldset>

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
    </SideSheet>
  );
}
