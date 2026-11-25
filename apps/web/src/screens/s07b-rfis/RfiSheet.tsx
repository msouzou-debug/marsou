"use client";

// S07b — R09 (ADR-0017)
//
/**
 * RfiSheet — the row-open sheet for one RFI, or the "new" form
 * (`rfi` omitted). Which of four things it shows is computed from the RFI's
 * own status and whether «Επεξεργασία» was pressed:
 *
 * - no `rfi` → the **new** form (question + SLA days).
 * - an existing RFI → the **read view**: number, question, who raised it and
 *   when, the due date, status, and the answer with who gave it and when
 *   (UAT 25/11/2026 — the row used to open on Enter only and the sheet showed
 *   the question alone). RFIs carry no subject line and no linked documents
 *   in the data model; the question is the subject.
 * - `OPEN` → also an **answer form** when the caller may write (`canWrite`) —
 *   RULE (ADR-0017): the answerer may be the raiser; there is no segregation
 *   rule here the way there is for a variation's decision.
 * - «Επεξεργασία» (writers, while not `CLOSED`, and only when `onUpdate` is
 *   wired) → the **edit form**: question and due date. RULE (owner, UAT
 *   25/11/2026): the due date is not before the day it was raised, said under
 *   the field before the API says it again (errors.rfiDueBeforeRaised).
 * - «Ολοκλήρωση» only appears on `ANSWERED`, behind a `ConfirmDialog` — RULE
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
 * | onUpdate  | (values) => Promise<boolean>? | `PATCH .../rfis/:rid`; true on success, which returns the sheet to the read view. |
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";
import { nicosiaDateOf, type Rfi } from "@ecapital/shared";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { zodResolver } from "@/lib/zod-resolver";
import { formatDate } from "@/lib/format";
import {
  RfiAnswerFormSchema,
  RfiFormSchema,
  rfiEditFormSchema,
  type RfiAnswerFormValues,
  type RfiEditFormValues,
  type RfiFormValues,
} from "./schema";

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
  onUpdate?: (values: RfiEditFormValues) => Promise<boolean>;
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

function editValuesOf(rfi: Rfi | undefined): RfiEditFormValues {
  return { questionEl: rfi?.questionEl ?? "", dueDate: rfi ? nicosiaDateOf(rfi.slaDueAt) : "" };
}

export function RfiSheet({ open, rfi, canWrite, saving = false, apiError, onClose, onCreate, onAnswer, onCloseRfi, onUpdate }: RfiSheetProps) {
  const t = useTranslations();
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const raisedOn = rfi ? nicosiaDateOf(rfi.raisedAt) : "";

  const createForm = useForm<RfiFormValues>({
    resolver: zodResolver<RfiFormValues>(RfiFormSchema),
    defaultValues: { questionEl: "", slaDays: 7 },
  });
  const answerForm = useForm<RfiAnswerFormValues>({
    resolver: zodResolver<RfiAnswerFormValues>(RfiAnswerFormSchema),
    defaultValues: { answerEl: "" },
  });
  const editForm = useForm<RfiEditFormValues>({
    resolver: zodResolver<RfiEditFormValues>(rfiEditFormSchema(raisedOn)),
    defaultValues: editValuesOf(rfi),
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

  const canEdit = canWrite && !!onUpdate && rfi.status !== "CLOSED";

  // ----------------------------------------------------------------- edit --
  if (editing && canEdit) {
    const errors = editForm.formState.errors;
    return (
      <SheetShell title={t("screens.s07b.editTitle", { number: rfi.number })} onClose={onClose}>
        <form
          noValidate
          onSubmit={editForm.handleSubmit(async (values) => {
            if (await onUpdate(values)) setEditing(false);
          })}
          className="flex flex-col gap-s-4"
        >
          <div className="flex flex-col gap-s-1">
            <label htmlFor="rfi-edit-question" className="text-fs-14 text-k-text">
              {t("screens.s07b.fields.question")}
            </label>
            <textarea
              id="rfi-edit-question"
              rows={4}
              {...editForm.register("questionEl")}
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
            <label htmlFor="rfi-edit-due" className="text-fs-14 text-k-text">
              {t("screens.s07b.fields.dueDate")}
            </label>
            <input
              id="rfi-edit-due"
              type="date"
              min={raisedOn}
              {...editForm.register("dueDate")}
              aria-invalid={errors.dueDate ? "true" : undefined}
              className="num h-11 w-[200px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
            />
            {errors.dueDate && (
              <p role="alert" className="text-fs-14 text-k-red">
                {t(errors.dueDate.message as string)}
              </p>
            )}
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
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60">
              {t("buttons.cancel")}
            </button>
          </div>
        </form>
      </SheetShell>
    );
  }

  // ------------------------------------------------------------ read view --
  const title = t("screens.s07b.sheetTitle", { number: rfi.number });
  const answerErrors = answerForm.formState.errors;

  return (
    <SheetShell title={title} onClose={onClose}>
      <dl className="grid gap-s-4 text-fs-14">
        <div>
          <dt className="text-k-text">{t("screens.s07b.fields.number")}</dt>
          <dd className="num text-k-ink">{rfi.number}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07b.fields.question")}</dt>
          <dd className="whitespace-pre-line text-k-ink">{rfi.questionEl}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07b.fields.raised")}</dt>
          <dd className="text-k-ink">
            {rfi.raisedByName} · <span className="num">{formatDate(rfi.raisedAt)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07b.fields.dueDate")}</dt>
          <dd className="num text-k-ink">{formatDate(rfi.slaDueAt)}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07b.fields.status")}</dt>
          <dd className="text-k-ink">{t(`rfiStatus.${rfi.status}`)}</dd>
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
            <div>
              <dt className="text-k-text">{t("screens.s07b.fields.answer")}</dt>
              <dd className="text-k-text">{t("screens.s07b.noAnswerYet")}</dd>
            </div>
          )
        ) : (
          <div>
            <dt className="text-k-text">{t("screens.s07b.fields.answer")}</dt>
            <dd className="whitespace-pre-line text-k-ink">{rfi.answerEl}</dd>
            {rfi.answeredAt && (
              <p className="num mt-s-1 text-fs-12 text-k-text-muted">
                {rfi.answeredByName} · {formatDate(rfi.answeredAt)}
              </p>
            )}
          </div>
        )}
      </dl>

      <div className="mt-s-4 flex flex-wrap items-center gap-s-3">
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              editForm.reset(editValuesOf(rfi));
              setEditing(true);
            }}
            disabled={saving}
            className="h-11 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
          >
            {t("buttons.edit")}
          </button>
        )}
        {/* RULE (ADR-0017): closes after it is answered and not before — the
            button only appears on ANSWERED, never on OPEN or CLOSED. Breach is
            a state, never a block: a BREACHED-when-answered RFI closes exactly
            the same way as one that came in on time. */}
        {rfi.status === "ANSWERED" && canWrite && (
          <button
            type="button"
            onClick={() => setConfirmCloseOpen(true)}
            disabled={saving}
            className="h-11 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-text disabled:opacity-60"
          >
            {t("buttons.complete")}
          </button>
        )}
      </div>

      {rfi.status === "CLOSED" && canWrite && <p className="mt-s-4 text-fs-14 text-k-text">{t("screens.s07b.closedNoEdit")}</p>}

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
