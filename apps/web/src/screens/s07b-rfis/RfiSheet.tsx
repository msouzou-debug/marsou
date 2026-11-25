"use client";

// S07b — R09 (ADR-0017)
//
/**
 * RfiSheet — the row-open sheet for one RFI, or the "new" form
 * (`rfi` omitted). Which of four things it shows is computed from the RFI's
 * own status and whether «Επεξεργασία» was pressed:
 *
 * - no `rfi` → the **new** form: question, SLA days, and (owner decision
 *   25/11/2026) the recipient, their e-mail and the day it was sent. RULE:
 *   eCapital sends no e-mail — the engineer sends the RFI from Outlook and
 *   records it here. The recipient is required; the sent day, when given, is
 *   today (not after today, not before the day it is raised). The recipient
 *   and the e-mail start from the contractor's contact (`recipientDefaults`,
 *   owner UAT 25/11/2026) and stay editable; nothing typed here goes back to
 *   the contractor.
 * - an existing RFI → the **read view**: number, question, recipient and
 *   e-mail, the day it was sent, who raised it and when, the due date,
 *   status, the answer with who gave it and when, and the correspondence
 *   filed against it (sent e-mail, reply) with «Προβολή» / «Λήψη» links
 *   (`documentViewHref` / `documentContentHref`, the S17 pattern). Writers
 *   attach more files while online (`onUpload`).
 * - the read view's actions, for a caller who may write (`canWrite`), owner
 *   UAT 25/11/2026 («there is no button to close it»):
 *   - «Επεξεργασία» (while not `CLOSED`, and only when `onUpdate` is wired)
 *     → the **edit form**: question, due date, recipient, e-mail and sent
 *     day. RULE: the due date and the sent day are not before the day it was
 *     raised, and the sent day is not after today.
 *   - «Απάντηση» (while `OPEN`) → the **answer form**: the answer and the day
 *     it arrived, today unless changed, not after today and not before the
 *     day it was raised. RULE (ADR-0017): the answerer may be the raiser.
 *   - «Κλείσιμο αιτήματος» (while not `CLOSED`) → the **close form**: a
 *     closing note, optional on an answered RFI and required on an
 *     unanswered one. RULE (owner, UAT 25/11/2026): an RFI closes with or
 *     without an answer. A breach never blocks any of the three.
 *   The button is «Κλείσιμο αιτήματος» and not «Κλείσιμο» because the
 *   sheet's own ✕ is already «Κλείσιμο» to a screen reader.
 * - `CLOSED` → the read view says who closed it, when and why, and offers
 *   no action but the correspondence upload.
 * - After an answer or a close the sheet stays on the RFI, back on its read
 *   view, with a short confirmation (role=status).
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
 * | onAnswer  | (values) => Promise<boolean> \| void | `POST .../answer`; true on success, which returns the sheet to the read view. |
 * | onCloseRfi| (closingNote: string) => Promise<boolean> \| void | `POST .../close`; true on success, likewise. |
 * | recipientDefaults | { name, email }? | The contract's contractor's contact, prefilled on the new form. |
 * | onUpdate  | (values) => Promise<boolean>? | `PATCH .../rfis/:rid`; true on success, which returns the sheet to the read view. |
 * | documents | RfiDocument[]?                | `GET .../rfis/:rid/documents`; absent while loading. |
 * | onUpload  | (file, titleEl) => Promise<boolean>? | `POST .../rfis/:rid/documents` (multipart). Omitted (or offline), no upload form. |
 * | uploading | boolean?                      |                                                    |
 * | uploadError | string?                     | The API's refusal of the last upload.              |
 * | today     | string?                       | yyyy-mm-dd in Nicosia; injectable for tests.       |
 */
import { useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle, X } from "lucide-react";
import { nicosiaDateOf, type Rfi, type RfiDocument } from "@ecapital/shared";
import { documentContentHref, documentViewHref } from "@/data/queries";
import { zodResolver } from "@/lib/zod-resolver";
import { formatDate } from "@/lib/format";
import {
  evidenceTitleError,
  rfiAnswerFormSchema,
  closingNoteError,
  rfiEditFormSchema,
  rfiFormSchema,
  type RfiAnswerFormValues,
  type RfiCloseFormValues,
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
  onAnswer: (values: RfiAnswerFormValues) => Promise<boolean> | void;
  onCloseRfi: (closingNote: string) => Promise<boolean> | void;
  onUpdate?: (values: RfiEditFormValues) => Promise<boolean>;
  /** Owner UAT 25/11/2026: the contractor's contact, the new form's starting recipient. */
  recipientDefaults?: { name: string; email: string };
  documents?: RfiDocument[];
  onUpload?: (file: File, titleEl: string) => Promise<boolean>;
  uploading?: boolean;
  uploadError?: string;
  today?: string;
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
  return {
    questionEl: rfi?.questionEl ?? "",
    dueDate: rfi ? nicosiaDateOf(rfi.slaDueAt) : "",
    recipientName: rfi?.recipientName ?? "",
    recipientEmail: rfi?.recipientEmail ?? "",
    sentOn: rfi?.sentOn ?? "",
  };
}

/** A message key from the form schema, said in the caller's language. */
function FieldError({ message }: { message?: string }) {
  const t = useTranslations();
  return message ? (
    <p role="alert" className="text-fs-14 text-k-red">
      {t(message)}
    </p>
  ) : null;
}

const INPUT = "h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink";

export function RfiSheet({
  open,
  rfi,
  canWrite,
  saving = false,
  apiError,
  onClose,
  onCreate,
  onAnswer,
  onCloseRfi,
  onUpdate,
  documents,
  onUpload,
  uploading = false,
  uploadError,
  today = nicosiaDateOf(new Date()),
  recipientDefaults,
}: RfiSheetProps) {
  const t = useTranslations();
  const [mode, setMode] = useState<"read" | "edit" | "answer" | "close">("read");
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadTitleError, setUploadTitleError] = useState<string | undefined>(undefined);
  const raisedOn = rfi ? nicosiaDateOf(rfi.raisedAt) : "";

  const createForm = useForm<RfiFormValues>({
    resolver: zodResolver<RfiFormValues>(rfiFormSchema(today)),
    defaultValues: {
      questionEl: "",
      slaDays: 7,
      recipientName: recipientDefaults?.name ?? "",
      recipientEmail: recipientDefaults?.email ?? "",
      sentOn: "",
    },
  });
  const answerForm = useForm<RfiAnswerFormValues>({
    resolver: zodResolver<RfiAnswerFormValues>(rfiAnswerFormSchema(raisedOn, today)),
    defaultValues: { answerEl: "", answeredOn: today },
  });
  const closeForm = useForm<RfiCloseFormValues>({ defaultValues: { closingNote: "" } });
  const editForm = useForm<RfiEditFormValues>({
    // An RFI from before the recipient existed can be corrected without one.
    resolver: zodResolver<RfiEditFormValues>(rfiEditFormSchema(raisedOn, today, !!rfi?.recipientName)),
    defaultValues: editValuesOf(rfi),
  });

  if (!open) return null;

  // ------------------------------------------------------------------ new --
  if (!rfi) {
    const errors = createForm.formState.errors;
    return (
      <SheetShell title={t("buttons.add")} onClose={onClose}>
        <form noValidate onSubmit={createForm.handleSubmit((values) => onCreate(values))} className="flex flex-col gap-s-4">
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
            <FieldError message={errors.questionEl?.message} />
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
              className={`num w-[160px] ${INPUT}`}
            />
          </div>
          <RecipientFields
            idPrefix="rfi"
            register={createForm.register}
            errors={{
              recipientName: errors.recipientName?.message,
              recipientEmail: errors.recipientEmail?.message,
              sentOn: errors.sentOn?.message,
            }}
            minSentOn={today}
            maxSentOn={today}
          />
          {recipientDefaults && (recipientDefaults.name || recipientDefaults.email) && (
            <p className="text-fs-14 text-k-text">{t("screens.s07b.recipientFromContractor")}</p>
          )}
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
  const canAnswer = canWrite && rfi.status === "OPEN";
  const canCloseRfi = canWrite && rfi.status !== "CLOSED";

  // ----------------------------------------------------------------- edit --
  if (mode === "edit" && canEdit) {
    const errors = editForm.formState.errors;
    return (
      <SheetShell title={t("screens.s07b.editTitle", { number: rfi.number })} onClose={onClose}>
        <form
          noValidate
          onSubmit={editForm.handleSubmit(async (values) => {
            if (await onUpdate(values)) setMode("read");
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
            <FieldError message={errors.questionEl?.message} />
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
              className={`num w-[200px] ${INPUT}`}
            />
            <FieldError message={errors.dueDate?.message} />
          </div>
          <RecipientFields
            idPrefix="rfi-edit"
            register={editForm.register}
            errors={{
              recipientName: errors.recipientName?.message,
              recipientEmail: errors.recipientEmail?.message,
              sentOn: errors.sentOn?.message,
            }}
            minSentOn={raisedOn}
            maxSentOn={today}
          />
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
            <button type="button" onClick={() => setMode("read")} disabled={saving} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60">
              {t("buttons.cancel")}
            </button>
          </div>
        </form>
      </SheetShell>
    );
  }

  // --------------------------------------------------------------- answer --
  if (mode === "answer" && canAnswer) {
    const errors = answerForm.formState.errors;
    return (
      <SheetShell title={t("screens.s07b.answerTitle", { number: rfi.number })} onClose={onClose}>
        <p className="mb-s-4 whitespace-pre-line text-fs-14 text-k-ink">{rfi.questionEl}</p>
        <form
          noValidate
          onSubmit={answerForm.handleSubmit(async (values) => {
            if (await onAnswer(values)) {
              setNotice(t("screens.s07b.answerSaved"));
              setMode("read");
            }
          })}
          className="flex flex-col gap-s-4"
        >
          <div className="flex flex-col gap-s-1">
            <label htmlFor="rfi-answer" className="text-fs-14 text-k-text">
              {t("screens.s07b.fields.answer")}
            </label>
            <textarea
              id="rfi-answer"
              rows={5}
              {...answerForm.register("answerEl")}
              aria-invalid={errors.answerEl ? "true" : undefined}
              className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink"
            />
            <FieldError message={errors.answerEl?.message} />
          </div>
          <div className="flex flex-col gap-s-1">
            <label htmlFor="rfi-answered-on" className="text-fs-14 text-k-text">
              {t("screens.s07b.fields.answeredOn")}
            </label>
            <input
              id="rfi-answered-on"
              type="date"
              min={raisedOn}
              max={today}
              {...answerForm.register("answeredOn")}
              aria-invalid={errors.answeredOn ? "true" : undefined}
              className={`num w-[200px] ${INPUT}`}
            />
            <p className="text-fs-14 text-k-text">{t("screens.s07b.fields.answeredOnHint")}</p>
            <FieldError message={errors.answeredOn?.message} />
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
            <button type="button" onClick={() => setMode("read")} disabled={saving} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60">
              {t("buttons.cancel")}
            </button>
          </div>
        </form>
      </SheetShell>
    );
  }

  // ---------------------------------------------------------------- close --
  if (mode === "close" && canCloseRfi) {
    const errors = closeForm.formState.errors;
    const answered = !!rfi.answerEl;
    return (
      <SheetShell title={t("screens.s07b.closeTitle", { number: rfi.number })} onClose={onClose}>
        <p className="mb-s-4 text-fs-14 text-k-text">
          {answered ? t("screens.s07b.closeConsequence") : t("screens.s07b.closeConsequenceUnanswered")}
        </p>
        <form
          noValidate
          onSubmit={closeForm.handleSubmit(async (values) => {
            if (await onCloseRfi(values.closingNote.trim())) {
              setNotice(t("screens.s07b.closeSaved"));
              setMode("read");
            }
          })}
          className="flex flex-col gap-s-4"
        >
          <div className="flex flex-col gap-s-1">
            <label htmlFor="rfi-closing-note" className="text-fs-14 text-k-text">
              {answered ? t("screens.s07b.fields.closingNoteOptional") : t("screens.s07b.fields.closingNote")}
            </label>
            <textarea
              id="rfi-closing-note"
              rows={4}
              {...closeForm.register("closingNote", {
                validate: (value) => closingNoteError(value, answered) ?? true,
              })}
              aria-invalid={errors.closingNote ? "true" : undefined}
              className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink"
            />
            <FieldError message={errors.closingNote?.message} />
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
              {t("screens.s07b.closeAction")}
            </button>
            <button type="button" onClick={() => setMode("read")} disabled={saving} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60">
              {t("buttons.cancel")}
            </button>
          </div>
        </form>
      </SheetShell>
    );
  }

  // ------------------------------------------------------------ read view --
  const title = t("screens.s07b.sheetTitle", { number: rfi.number });
  const notRecorded = <span className="text-k-text">{t("screens.s07b.notRecorded")}</span>;

  async function submitUpload() {
    if (!uploadFile || !onUpload) return;
    const titleError = evidenceTitleError(uploadTitle);
    setUploadTitleError(titleError);
    if (titleError) return;
    if (await onUpload(uploadFile, uploadTitle.trim())) {
      setUploadFile(null);
      setUploadTitle("");
      setUploadOpen(false);
    }
  }

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
          <dt className="text-k-text">{t("screens.s07b.fields.recipientName")}</dt>
          <dd className="text-k-ink">
            {rfi.recipientName ?? notRecorded}
            {rfi.recipientEmail && <span className="block text-k-text">{rfi.recipientEmail}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07b.fields.sentOn")}</dt>
          <dd className="num text-k-ink">{rfi.sentOn ? formatDate(rfi.sentOn) : notRecorded}</dd>
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

        <div>
          <dt className="text-k-text">{t("screens.s07b.fields.answer")}</dt>
          {rfi.answerEl ? (
            <>
              <dd className="whitespace-pre-line text-k-ink">{rfi.answerEl}</dd>
              {rfi.answeredAt && (
                <p className="num mt-s-1 text-fs-14 text-k-text">
                  {rfi.answeredByName} · {formatDate(rfi.answeredOn ?? rfi.answeredAt)}
                </p>
              )}
            </>
          ) : (
            <dd className="text-k-text">{t("screens.s07b.noAnswerYet")}</dd>
          )}
        </div>

        {/* Owner UAT 25/11/2026: who closed it, when, and why. */}
        {rfi.status === "CLOSED" && (
          <div>
            <dt className="text-k-text">{t("screens.s07b.fields.closed")}</dt>
            <dd className="text-k-ink">
              {rfi.closedByName ?? notRecorded}
              {rfi.closedAt && (
                <>
                  {" · "}
                  <span className="num">{formatDate(rfi.closedAt)}</span>
                </>
              )}
            </dd>
            {rfi.closingNote && <dd className="mt-s-1 whitespace-pre-line text-k-ink">{rfi.closingNote}</dd>}
          </div>
        )}
      </dl>

      {notice && (
        <p role="status" className="mt-s-4 rounded-k border border-k-grey bg-k-surface p-s-3 text-fs-14 text-k-ink">
          {notice}
        </p>
      )}

      {(canEdit || canAnswer || canCloseRfi) && (
        <div className="mt-s-4 flex flex-wrap items-center gap-s-3">
          {canAnswer && (
            <button
              type="button"
              onClick={() => {
                answerForm.reset({ answerEl: "", answeredOn: today });
                setNotice(undefined);
                setMode("answer");
              }}
              disabled={saving}
              className="h-11 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              {t("screens.s07b.answerAction")}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                editForm.reset(editValuesOf(rfi));
                setNotice(undefined);
                setMode("edit");
              }}
              disabled={saving}
              className="h-11 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
            >
              {t("buttons.edit")}
            </button>
          )}
          {/* RULE (owner, UAT 25/11/2026): open or answered, an RFI can be
              closed; without an answer the close form asks why. Breach is a
              state, never a block. */}
          {canCloseRfi && (
            <button
              type="button"
              onClick={() => {
                closeForm.reset({ closingNote: "" });
                setNotice(undefined);
                setMode("close");
              }}
              disabled={saving}
              className="h-11 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-text disabled:opacity-60"
            >
              {t("screens.s07b.closeAction")}
            </button>
          )}
        </div>
      )}

      {rfi.status === "CLOSED" && canWrite && <p className="mt-s-4 text-fs-14 text-k-text">{t("screens.s07b.closedNoEdit")}</p>}

      {apiError && (
        <p role="alert" className="mt-s-4 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {apiError}
        </p>
      )}

      {/* Owner decision 25/11/2026: the correspondence — the e-mail sent from
          Outlook and the reply — filed against the RFI and queued for
          eArchive. «Προβολή» opens a PDF in a new tab and saves any other
          type (a .msg or .eml is saved, then opened by Outlook); «Λήψη»
          always saves (`?download=1`, UAT 25/11/2026). Attaching stays open
          after the RFI closes: a late reply still belongs on it. */}
      <section aria-labelledby="rfi-evidence-title" className="mt-s-6 border-t border-k-grey pt-s-4">
        <h3 id="rfi-evidence-title" className="mb-s-3 text-fs-16 font-bold text-k-blue-deep">
          {t("screens.s07b.evidence.title")}
        </h3>
        {documents === undefined ? (
          <p className="text-fs-14 text-k-text-muted">{t("common.loading")}</p>
        ) : documents.length === 0 ? (
          <p className="text-fs-14 text-k-text">{t("screens.s07b.evidence.empty")}</p>
        ) : (
          <ul className="grid gap-s-2">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-s-2 border-b border-k-grey pb-s-2">
                <span className="text-fs-14 text-k-ink">
                  {doc.titleEl}
                  <span className="num block text-fs-14 text-k-text">
                    {formatDate(doc.createdAt)} · {doc.protocolNumber ?? t("screens.s07b.evidence.pendingFiling")}
                  </span>
                </span>
                <span className="flex items-baseline gap-s-3">
                  <a href={documentViewHref(doc.id, doc.mime)} target="_blank" rel="noopener" className="text-fs-14 text-k-blue underline">
                    {t("buttons.view")}
                    <span className="sr-only"> {doc.titleEl}</span>
                  </a>
                  <a href={documentContentHref(doc.id, { download: true })} className="text-fs-14 text-k-blue underline">
                    {t("buttons.download")}
                    <span className="sr-only"> {doc.titleEl}</span>
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}

        {canWrite && onUpload && (
          <div className="mt-s-4">
            {!uploadOpen ? (
              <button type="button" onClick={() => setUploadOpen(true)} className="text-fs-14 text-k-blue">
                {t("screens.s07b.evidence.upload")}
              </button>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitUpload();
                }}
                className="grid gap-s-3"
              >
                <p className="text-fs-14 text-k-text">{t("screens.s07b.evidence.hint")}</p>
                <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                  {t("screens.s07b.evidence.file")}
                  <input
                    type="file"
                    accept=".msg,.eml,.pdf,application/pdf,message/rfc822,application/vnd.ms-outlook"
                    onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                    className="text-fs-14 text-k-ink"
                  />
                </label>
                <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                  {t("screens.s07b.evidence.titleLabel")}
                  <input
                    type="text"
                    value={uploadTitle}
                    onChange={(event) => setUploadTitle(event.target.value)}
                    aria-invalid={uploadTitleError ? "true" : undefined}
                    className={INPUT}
                  />
                </label>
                <FieldError message={uploadTitleError} />
                {uploadError && (
                  <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
                    {uploadError}
                  </p>
                )}
                <div className="flex items-center gap-s-3">
                  <button
                    type="submit"
                    disabled={uploading || !uploadFile}
                    className="flex h-11 items-center justify-center gap-s-2 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
                  >
                    {uploading && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
                    {uploading ? t("screens.s07b.evidence.saving") : t("buttons.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadOpen(false);
                      setUploadFile(null);
                      setUploadTitle("");
                      setUploadTitleError(undefined);
                    }}
                    disabled={uploading}
                    className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60"
                  >
                    {t("buttons.cancel")}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>

    </SheetShell>
  );
}

// ------------------------------------------------- the recipient fields --

type RecipientKey = "recipientName" | "recipientEmail" | "sentOn";
type RegisterRecipient = (name: RecipientKey) => UseFormRegisterReturn<RecipientKey>;

/**
 * Owner decision 25/11/2026: who the RFI went to, their address and the day
 * it left — the same three fields on the new form and the edit form. The
 * hint under the sent day says why there is no «Αποστολή» button.
 */
function RecipientFields({
  idPrefix,
  register,
  errors,
  minSentOn,
  maxSentOn,
}: {
  idPrefix: string;
  register: RegisterRecipient;
  errors: Partial<Record<RecipientKey, string>>;
  minSentOn: string;
  maxSentOn: string;
}) {
  const t = useTranslations();
  return (
    <>
      <div className="flex flex-col gap-s-1">
        <label htmlFor={`${idPrefix}-recipient`} className="text-fs-14 text-k-text">
          {t("screens.s07b.fields.recipientName")}
        </label>
        <input
          id={`${idPrefix}-recipient`}
          type="text"
          autoComplete="off"
          {...register("recipientName")}
          aria-invalid={errors.recipientName ? "true" : undefined}
          className={INPUT}
        />
        <p className="text-fs-14 text-k-text">{t("screens.s07b.fields.recipientNameHint")}</p>
        <FieldError message={errors.recipientName} />
      </div>
      <div className="flex flex-col gap-s-1">
        <label htmlFor={`${idPrefix}-recipient-email`} className="text-fs-14 text-k-text">
          {t("screens.s07b.fields.recipientEmail")}
        </label>
        <input
          id={`${idPrefix}-recipient-email`}
          type="email"
          autoComplete="off"
          {...register("recipientEmail")}
          aria-invalid={errors.recipientEmail ? "true" : undefined}
          className={INPUT}
        />
        <FieldError message={errors.recipientEmail} />
      </div>
      <div className="flex flex-col gap-s-1">
        <label htmlFor={`${idPrefix}-sent-on`} className="text-fs-14 text-k-text">
          {t("screens.s07b.fields.sentOn")}
        </label>
        <input
          id={`${idPrefix}-sent-on`}
          type="date"
          min={minSentOn}
          max={maxSentOn}
          {...register("sentOn")}
          aria-invalid={errors.sentOn ? "true" : undefined}
          className={`num w-[200px] ${INPUT}`}
        />
        <p className="text-fs-14 text-k-text">{t("screens.s07b.fields.sentOnHint")}</p>
        <FieldError message={errors.sentOn} />
      </div>
    </>
  );
}
