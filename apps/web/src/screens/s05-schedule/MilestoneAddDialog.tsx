"use client";

// S05 — R06
//
/**
 * MilestoneAddDialog — «Προσθήκη» on the schedule table (build brief: "a
 * small form: titleEl, baselineDate, isGate, sortOrder default last"). Built
 * the same way S03's `PhaseDialog` is — a native `<dialog>`, not the S24/S08
 * right sheet — because this form is three fields and never grows an edit
 * mode: the baseline date is immutable once set (ADR-0014), so there is
 * nothing to "reopen" a milestone for a second POST could not just add.
 *
 * | Prop      | Type                              | Notes                                                |
 * |-----------|-----------------------------------|-----------------------------------------------------------|
 * | open      | boolean                           |                                                             |
 * | saving    | boolean                           | Disables the form; «Αποθήκευση» shows the spinner.           |
 * | apiError  | string?                           | The API's own sentence for a failed `POST`.                  |
 * | onCancel  | () => void                        |                                                             |
 * | onSubmit  | (values: MilestoneFormValues) => void | Fired once the form is valid.                          |
 */
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { zodResolver } from "@/lib/zod-resolver";
import { MilestoneFormSchema, type MilestoneFormValues } from "./schema";

export interface MilestoneAddDialogProps {
  open: boolean;
  saving?: boolean;
  apiError?: string;
  onCancel: () => void;
  onSubmit: (values: MilestoneFormValues) => void;
}

const DEFAULTS: MilestoneFormValues = { titleEl: "", baselineDate: "", isGate: false };

export function MilestoneAddDialog({ open, saving = false, apiError, onCancel, onSubmit }: MilestoneAddDialogProps) {
  const t = useTranslations();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MilestoneFormValues>({
    resolver: zodResolver<MilestoneFormValues>(MilestoneFormSchema),
    defaultValues: DEFAULTS,
  });

  // jsdom (unit tests) has no <dialog> implementation — same fallback
  // `PhaseDialog` and `ConfirmDialog` use.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  // Every reopen starts from a blank form — this dialog only ever creates.
  useEffect(() => {
    if (!open) reset(DEFAULTS);
  }, [open, reset]);

  function fieldError(key: keyof MilestoneFormValues): string | undefined {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="w-[min(90vw,420px)] rounded-k border-none p-s-6 shadow-k backdrop:bg-k-ink/60"
    >
      <h2 className="text-fs-20">{t("screens.s05.addTitle")}</h2>
      <form onSubmit={handleSubmit(onSubmit)} className="mt-s-4 flex flex-col gap-s-4">
        <div className="flex flex-col gap-s-1">
          <label htmlFor="ms-title" className="text-fs-14 text-k-text">
            {t("screens.s05.fields.title")}
          </label>
          <input
            id="ms-title"
            type="text"
            {...register("titleEl")}
            aria-invalid={errors.titleEl ? "true" : undefined}
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
          {fieldError("titleEl") && (
            <p role="alert" className="text-fs-14 text-k-red">
              {fieldError("titleEl")}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="ms-baseline" className="text-fs-14 text-k-text">
            {t("screens.s05.fields.baseline")}
          </label>
          <input
            id="ms-baseline"
            type="date"
            {...register("baselineDate")}
            aria-invalid={errors.baselineDate ? "true" : undefined}
            className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          />
          {fieldError("baselineDate") && (
            <p role="alert" className="text-fs-14 text-k-red">
              {fieldError("baselineDate")}
            </p>
          )}
        </div>

        <label className="flex items-center gap-s-2 text-fs-14 text-k-ink">
          <input type="checkbox" {...register("isGate")} />
          {t("screens.s05.fields.isGate")}
        </label>

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
            onClick={onCancel}
            disabled={saving}
            className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60"
          >
            {t("buttons.cancel")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
