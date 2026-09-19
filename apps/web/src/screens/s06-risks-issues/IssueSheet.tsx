"use client";

// S06 — R07
//
/**
 * IssueSheet — the right sheet for adding or editing one issue.
 *
 * | Prop     | Type      | Notes                                                              |
 * |----------|-----------|--------------------------------------------------------------------|
 * | open     | boolean   |                                                                      |
 * | issue    | Issue?    | Omit for «Προσθήκη»; pass the row for an edit.                        |
 * | saving   | boolean   |                                                                      |
 * | apiError | string?   |                                                                      |
 * | onClose  | () => void|                                                                      |
 * | onSave   | (values: IssueFormValues) => void |                                             |
 *
 * RULE (R07, `projects.controller.ts`): «Ανέφερε» (`raisedByName`) is never a
 * field here — the API sets it from whoever is signed in, so this sheet only
 * ever shows it, read-only, when editing an existing issue.
 */
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";
import { IssueStatus, type Issue } from "@ecapital/shared";
import { zodResolver } from "@/lib/zod-resolver";
import { IssueFormSchema, type IssueFormValues } from "./schema";

export interface IssueSheetProps {
  open: boolean;
  issue?: Issue;
  saving?: boolean;
  apiError?: string;
  onClose: () => void;
  onSave: (values: IssueFormValues) => void;
}

function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

export function IssueSheet({ open, issue, saving = false, apiError, onClose, onSave }: IssueSheetProps) {
  const t = useTranslations();
  const tf = useTranslations("screens.s06.issueFields");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IssueFormValues>({
    resolver: zodResolver<IssueFormValues>(IssueFormSchema),
    defaultValues: {
      descriptionEl: issue?.descriptionEl ?? "",
      dueDate: issue?.dueDate ?? null,
      status: issue?.status ?? "OPEN",
    },
  });

  if (!open) return null;

  function fieldError(key: keyof IssueFormValues): string | undefined {
    const message = errors[key]?.message;
    return typeof message === "string" ? t(message) : undefined;
  }

  return (
    <div
      role="dialog"
      aria-label={issue ? t("screens.s06.editIssueTitle") : t("screens.s06.addIssueTitle")}
      className="fixed inset-0 flex flex-col bg-k-white shadow-k desktop:inset-y-0 desktop:left-auto desktop:right-0 desktop:w-[480px]"
    >
      <header className="flex items-start justify-between border-b border-k-grey p-s-5">
        <h2 className="text-fs-20">{issue ? t("screens.s06.editIssueTitle") : t("screens.s06.addIssueTitle")}</h2>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-k p-s-2 text-k-text hover:bg-k-surface">
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-auto p-s-5">
        {issue && (
          <p className="mb-s-4 text-fs-14 text-k-text">
            {t("screens.s06.issueColumns.raisedBy")}: {issue.raisedByName}
          </p>
        )}
        <form onSubmit={handleSubmit(onSave)} className="flex flex-col gap-s-4">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="is-description" className="text-fs-14 text-k-text">
              {tf("description")}
            </label>
            <textarea
              id="is-description"
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

          <div className="flex flex-col gap-s-1">
            <label htmlFor="is-due" className="text-fs-14 text-k-text">
              {tf("dueDate")}
            </label>
            <input
              id="is-due"
              type="date"
              {...register("dueDate", { setValueAs: blankToNull })}
              className="num h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
          </div>

          <div className="flex flex-col gap-s-1">
            <label htmlFor="is-status" className="text-fs-14 text-k-text">
              {tf("status")}
            </label>
            <select id="is-status" {...register("status")} className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink">
              {IssueStatus.options.map((option) => (
                <option key={option} value={option}>
                  {t(`issueStatus.${option}`)}
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
