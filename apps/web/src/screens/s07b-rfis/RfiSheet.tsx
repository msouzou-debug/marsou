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
 *   today (not after today, not before the day it is raised).
 * - an existing RFI → the **read view**: number, question, recipient and
 *   e-mail, the day it was sent, who raised it and when, the due date,
 *   status, the answer with who gave it and when, and the correspondence
 *   filed against it (sent e-mail, reply) with «Προβολή» / «Λήψη» links
 *   (`documentViewHref` / `documentContentHref`, the S17 pattern). Writers
 *   attach more files while online (`onUpload`).
 * - `OPEN` → also an **answer form** when the caller may write (`canWrite`) —
 *   RULE (ADR-0017): the answerer may be the raiser; there is no segregation
 *   rule here the way there is for a variation's decision.
 * - «Επεξεργασία» (writers, while not `CLOSED`, and only when `onUpdate` is
 *   wired) → the **edit form**: question, due date, recipient, e-mail and
 *   sent day. RULE (owner, UAT 25/11/2026): the due date and the sent day are
 *   not before the day it was raised, and the sent day is not after today,
 *   said under the field before the API says it again.
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
import { ConfirmDialog } from "@/components/confirm-dialog";
import { documentContentHref, documentViewHref } from "@/data/queries";
import { zodResolver } from "@/lib/zod-resolver";
import { formatDate } from "@/lib/format";
import {
  RfiAnswerFormSchema,
  evidenceTitleError,
  rfiEditFormSchema,
  rfiFormSchema,
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
}: RfiSheetProps) {
  const t = useTranslations();
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadTitleError, setUploadTitleError] = useState<string | undefined>(undefined);
  const raisedOn = rfi ? nicosiaDateOf(rfi.raisedAt) : "";

  const createForm = useForm<RfiFormValues>({
    resolver: zodResolver<RfiFormValues>(rfiFormSchema(today)),
    defaultValues: { questionEl: "", slaDays: 7, recipientName: "", recipientEmail: "", sentOn: "" },
  });
  const answerForm = useForm<RfiAnswerFormValues>({
    resolver: zodResolver<RfiAnswerFormValues>(RfiAnswerFormSchema),
    defaultValues: { answerEl: "" },
  });
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
              <FieldError message={answerErrors.answerEl?.message} />
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
