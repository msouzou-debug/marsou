"use client";

// S07b — R09 (ADR-0017)
//
/**
 * RfiSheet — the row-open sheet for one RFI, or the "new" form
 * (`rfi` omitted). Which of three things it shows is computed from the RFI's
 * own status:
 *
 * - no `rfi` → the **new** form (question + SLA days).
 * - `OPEN` → the question, plus an **answer form** when the caller may write
 *   (`canWrite`) — RULE (ADR-0017): the answerer may be the raiser; there is
 *   no segregation rule here the way there is for a variation's decision.
 * - `ANSWERED` or `CLOSED` → the question and the answer, read-only.
 *   «Ολοκλήρωση» only appears on `ANSWERED`, behind a `ConfirmDialog` — RULE
 *   (ADR-0017): an RFI closes after it is answered and not before, and a
 *   breach never blocks this either way.
 *
 * | Prop      | Type                          | Notes                                          |
 * |-----------|-------------------------------|--------------------------------------------------|
 * | open      | boolean                       |                                                    |
 * | rfi       | Rfi?                          | Omit for the "new" form.                           |
 * | canWrite  | boolean                       | `canWriteRfis(roles)` — gates every form and button. |
 * | saving    | boolean?                      |                                                    |
 * | apiError  | string?                       |                                                    |
 * | onClose   | () => void                    |                                                    |
 * | onCreate  | (values: RfiFormValues) => void |                                                  |
 * | onAnswer  | (answerEl: string) => void    |                                                    |
 * | onCloseRfi| () => void                    | `POST .../close`, after the `ConfirmDialog`.       |
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";
import type { Rfi } from "@ecapital/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { zodResolver } from "@/lib/zod-resolver";
import { formatDate } from "@/lib/format";
import { RfiAnswerFormSchema, RfiFormSchema, type RfiAnswerFormValues, type RfiFormValues } from "./schema";

export interface RfiSheetProps {
  open: boolean;
  rfi?: Rfi;
  canWrite: boolean;
  saving?: boolean;
  apiError?: string;
  onClose: () => void;
  onCreate: (values: RfiFormValues) => void;
  onAnswer: (answerEl: string) => void;
  onCloseRfi: () => void;
}

function SheetShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useTranslations();
  return (
    <div
      role="dialog"
      aria-label={title}
      className="fixed inset-0 desktop:inset-y-0 desktop:left-auto desktop:right-0 desktop:w-[480px] flex flex-col bg-k-white shadow-k"
    >
      <header className="flex items-start justify-between border-b border-k-grey p-s-5">
        <h2 className="text-fs-20">{title}</h2>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="rounded-k p-s-2 text-k-text hover:bg-k-surface">
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>
      <div className="flex-1 overflow-auto p-s-5">{children}</div>
    </div>
  );
}

export function RfiSheet({ open, rfi, canWrite, saving = false, apiError, onClose, onCreate, onAnswer, onCloseRfi }: RfiSheetProps) {
  const t = useTranslations();
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const createForm = useForm<RfiFormValues>({
    resolver: zodResolver<RfiFormValues>(RfiFormSchema),
    defaultValues: { questionEl: "", slaDays: 7 },
  });
  const answerForm = useForm<RfiAnswerFormValues>({
    resolver: zodResolver<RfiAnswerFormValues>(RfiAnswerFormSchema),
    defaultValues: { answerEl: "" },
  });

  if (!open) return null;

  // ------------------------------------------------------------------ new --
  if (!rfi) {
    const errors = createForm.formState.errors;
    return (
      <SheetShell title={t("buttons.add")} onClose={onClose}>
        <form onSubmit={createForm.handleSubmit((values) => onCreate(values))} className="flex flex-col gap-s-4">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="rfi-question" className="text-fs-14 text-k-text">
              {t("screens.s07b.fields.question")}
            </label>
            <textarea
              id="rfi-question"
              rows={3}
              {...createForm.register("questionEl")}
              aria-invalid={errors.questionEl ? "true" : undefined}
              className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink"
            />
            {errors.questionEl && (
              <p role="alert" className="text-fs-14 text-k-red">
                {t(errors.questionEl.message as string)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-s-1">
            <label htmlFor="rfi-sla-days" className="text-fs-14 text-k-text">
              {t("screens.s07b.fields.slaDays")}
            </label>
            <input
              id="rfi-sla-days"
              type="number"
              step="1"
              inputMode="numeric"
              {...createForm.register("slaDays", { setValueAs: (value: string) => (value === "" ? NaN : Number(value)) })}
              aria-invalid={errors.slaDays ? "true" : undefined}
              className="num h-11 w-[160px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
          </div>
          {apiError && (
            <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
              {apiError}
            </p>
          )}
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

  // ------------------------------------------------------------- existing --
  const title = t("screens.s07b.sheetTitle", { number: rfi.number });
  const answerErrors = answerForm.formState.errors;

  return (
    <SheetShell title={title} onClose={onClose}>
      <dl className="grid gap-s-4 text-fs-14">
        <div>
          <dt className="text-k-text">{t("screens.s07b.fields.question")}</dt>
          <dd className="text-k-ink">{rfi.questionEl}</dd>
        </div>

        {rfi.status === "OPEN" ? (
          canWrite ? (
            <form onSubmit={answerForm.handleSubmit((values) => onAnswer(values.answerEl))} className="grid gap-s-2">
              <label htmlFor="rfi-answer" className="text-fs-14 text-k-text">
                {t("screens.s07b.fields.answer")}
              </label>
              <textarea
                id="rfi-answer"
                rows={4}
                {...answerForm.register("answerEl")}
                aria-invalid={answerErrors.answerEl ? "true" : undefined}
                className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink"
              />
              {answerErrors.answerEl && (
                <p role="alert" className="text-fs-14 text-k-red">
                  {t(answerErrors.answerEl.message as string)}
                </p>
              )}
              {apiError && (
                <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
                  {apiError}
                </p>
              )}
              <button
                type="submit"
                disabled={saving}
                className="flex h-11 w-fit items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
              >
                {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
                {t("buttons.save")}
              </button>
            </form>
          ) : (
            <p className="text-fs-14 text-k-text">{t("screens.s07b.noAnswerYet")}</p>
          )
        ) : (
          <div>
            <dt className="text-k-text">{t("screens.s07b.fields.answer")}</dt>
            <dd className="text-k-ink">{rfi.answerEl}</dd>
            {rfi.answeredAt && (
              <p className="num mt-s-1 text-fs-12 text-k-text-muted">
                {rfi.answeredByName} · {formatDate(rfi.answeredAt)}
              </p>
            )}
          </div>
        )}
      </dl>

      {/* RULE (ADR-0017): closes after it is answered and not before — the
          button only appears on ANSWERED, never on OPEN or CLOSED. Breach is
          a state, never a block: a BREACHED-when-answered RFI closes exactly
          the same way as one that came in on time. */}
      {rfi.status === "ANSWERED" && canWrite && (
        <button
          type="button"
          onClick={() => setConfirmCloseOpen(true)}
          disabled={saving}
          className="mt-s-4 h-11 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-text disabled:opacity-60"
        >
          {t("buttons.complete")}
        </button>
      )}

      {apiError && rfi.status !== "OPEN" && (
        <p role="alert" className="mt-s-4 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {apiError}
        </p>
      )}

      <ConfirmDialog
        open={confirmCloseOpen}
        title={t("screens.s07b.closeConfirmTitle")}
        consequence={t("screens.s07b.closeConfirmConsequence")}
        destructiveLabel={t("buttons.complete")}
        onCancel={() => setConfirmCloseOpen(false)}
        onConfirm={() => {
          setConfirmCloseOpen(false);
          onCloseRfi();
        }}
      />
    </SheetShell>
  );
}
