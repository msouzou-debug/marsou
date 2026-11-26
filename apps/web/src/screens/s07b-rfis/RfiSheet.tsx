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
 *   Owner request 26/11/2026 («attach e-mail/letter document and save, or
 *   send e-mail directly»): an optional attachment field (one or more files,
 *   only where `onUpload` is wired — online, and a writer) and two buttons:
 *   «Αποθήκευση», and «Αποθήκευση και αποστολή e-mail», which also records
 *   today as the sent day and downloads an Outlook draft (.eml) with the
 *   files attached. The second is disabled, with the reason written under
 *   it, while no recipient e-mail is filled in. The screen does the saving
 *   (`onCreate(values, { files, sendMail })`).
 * - an existing RFI → the **read view**: number, question, recipient and
 *   e-mail, the day it was sent, who raised it and when, the due date,
 *   status, the answer with who gave it and when, and the correspondence
 *   filed against it (sent e-mail, reply) with «Προβολή» / «Λήψη» links
 *   (`CorrespondenceSection`, the S17 pattern). Writers attach more files
 *   while online (`onUpload`). After a save whose files did not all make it
 *   (`filingReport`), the section says which and why and opens its upload
 *   form for the retry; the RFI itself is saved.
 * - the read view's actions, for a caller who may write (`canWrite`), owner
 *   UAT 25/11/2026 («there is no button to close it»):
 *   - «Επεξεργασία» (while not `CLOSED`, and only when `onUpdate` is wired)
 *     → the **edit form**: question, due date, recipient, e-mail and sent
 *     day. RULE: the due date and the sent day are not before the day it was
 *     raised, and the sent day is not after today.
 *   - «Απάντηση» (while `OPEN`) → the **answer form**: the answer and the day
 *     it arrived, today unless changed, not after today and not before the
 *     day it was raised. RULE (ADR-0017): the answerer may be the raiser.
 *     Owner request 26/11/2026: an optional «Επιστολή ή e-mail αναδόχου»,
 *     one or more files, filed against the RFI once the answer is saved.
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
 * | onCreate  | (values, options) => void     | `options.files` to file, `options.sendMail` for the Outlook draft. |
 * | onAnswer  | (values, files) => Promise<boolean> \| void | `POST .../answer`, then the files; true once the answer is saved, which returns the sheet to the read view. |
 * | onCloseRfi| (closingNote: string) => Promise<boolean> \| void | `POST .../close`; true on success, likewise. |
 * | recipientDefaults | { name, email }? | The contract's contractor's contact, prefilled on the new form. |
 * | onUpdate  | (values) => Promise<boolean>? | `PATCH .../rfis/:rid`; true on success, which returns the sheet to the read view. |
 * | documents | RfiDocument[]?                | `GET .../rfis/:rid/documents`; absent while loading. |
 * | onUpload  | (file, titleEl) => Promise<boolean>? | `POST .../rfis/:rid/documents` (multipart). Omitted (or offline), no upload form and no attachment field. |
 * | uploading | boolean?                      |                                                    |
 * | uploadError | string?                     | The API's refusal of the last upload.              |
 * | filingReport | FilingReport?              | What happened to a form's files after the save: failures, the draft. |
 * | today     | string?                       | yyyy-mm-dd in Nicosia; injectable for tests.       |
 * | contractFacts | RfiContractFacts?         | Contract and project for the e-mail. Omitted, no «Αποστολή με e-mail» and no «Αποθήκευση και αποστολή e-mail». |
 * | onMarkSent | (sentOn) => Promise<boolean>? | `PATCH .../rfis/:rid` `{ sentOn }`, the one-click «sent today». |
 *
 * Owner UAT 25/11/2026 («The RFI should go through e-mail»): the read view of
 * an RFI that is not closed offers «Αποστολή με e-mail» to a writer. There is
 * no outgoing mail server, so it is a `mailto:` link that opens Outlook with
 * the recipient, the subject (number — contract — short question) and the
 * body already written (`rfi-mail.ts`). With no recipient e-mail it is
 * disabled and says why. Once opened, the sheet reminds the user to record
 * the day it left — one click sets «Ημερομηνία αποστολής» to today — and to
 * file the sent message under «Αλληλογραφία».
 *
 * Owner UAT 25/11/2026 («there is no close button; it stays in limbo»): the
 * sheet is the shared `SideSheet` — «Πίσω στη λίστα» at the top, Escape and a
 * click beside it all close it, in every mode, after a close as before it.
 */
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { nicosiaDateOf, type Rfi, type RfiDocument } from "@ecapital/shared";
import { zodResolver } from "@/lib/zod-resolver";
import { formatDate } from "@/lib/format";
import type { FilingReport } from "@/lib/file-each";
import {
  AttachmentField,
  CorrespondenceSection,
  MailtoPanel,
  RecipientFields,
  SaveButtons,
  type RecipientLabels,
} from "@/components/correspondence";
import {
  rfiAnswerFormSchema,
  closingNoteError,
  rfiEditFormSchema,
  rfiFormSchema,
  type RfiAnswerFormValues,
  type RfiCloseFormValues,
  type RfiEditFormValues,
  type RfiFormValues,
} from "./schema";
import { buildRfiMail, mailtoHref, type RfiMailFacts } from "./rfi-mail";
import { SideSheet } from "@/components/side-sheet";

/** Owner request 26/11/2026: what the new form hands the screen besides the values. */
export interface RfiSaveOptions {
  /** Filed against the RFI once it exists. */
  files: File[];
  /** «Αποθήκευση και αποστολή e-mail»: sent today, and the Outlook draft. */
  sendMail: boolean;
}

export interface RfiSheetProps {
  open: boolean;
  rfi?: Rfi;
  canWrite: boolean;
  saving?: boolean;
  apiError?: string;
  onClose: () => void;
  onCreate: (values: RfiFormValues, options: RfiSaveOptions) => void;
  onAnswer: (values: RfiAnswerFormValues, files: File[]) => Promise<boolean> | void;
  onCloseRfi: (closingNote: string) => Promise<boolean> | void;
  onUpdate?: (values: RfiEditFormValues) => Promise<boolean>;
  /** Owner UAT 25/11/2026: the contractor's contact, the new form's starting recipient. */
  recipientDefaults?: { name: string; email: string };
  documents?: RfiDocument[];
  onUpload?: (file: File, titleEl: string) => Promise<boolean>;
  uploading?: boolean;
  uploadError?: string;
  /** Owner request 26/11/2026: the files a form could not file after saving, and the draft. */
  filingReport?: FilingReport;
  today?: string;
  /** Owner UAT 25/11/2026: the contract and project, for «Αποστολή με e-mail». Omitted, no e-mail button. */
  contractFacts?: RfiContractFacts;
  /** Owner UAT 25/11/2026: `PATCH .../rfis/:rid` with `{ sentOn }`; true once saved. */
  onMarkSent?: (sentOn: string) => Promise<boolean>;
}

export type RfiContractFacts = Pick<RfiMailFacts, "contractNo" | "contractorName" | "projectCode" | "projectTitle">;

// OWNER UAT 25/11/2026: the shared sheet — above the top bar and the
// table's sticky header, with «Πίσω στη λίστα», Escape and the backdrop as
// its ways out (`components/side-sheet`).
const SheetShell = SideSheet;

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
  filingReport,
  today = nicosiaDateOf(new Date()),
  recipientDefaults,
  contractFacts,
  onMarkSent,
}: RfiSheetProps) {
  const t = useTranslations();
  const [mode, setMode] = useState<"read" | "edit" | "answer" | "close">("read");
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [answerFiles, setAnswerFiles] = useState<File[]>([]);
  const raisedOn = rfi ? nicosiaDateOf(rfi.raisedAt) : "";
  const recipientLabels: RecipientLabels = {
    name: t("screens.s07b.fields.recipientName"),
    nameHint: t("screens.s07b.fields.recipientNameHint"),
    email: t("screens.s07b.fields.recipientEmail"),
    sentOn: t("screens.s07b.fields.sentOn"),
    sentOnHint: t("screens.s07b.fields.sentOnHint"),
  };

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
  const recipientEmailTyped = useWatch({ control: createForm.control, name: "recipientEmail" }) ?? "";

  if (!open) return null;

  // ------------------------------------------------------------------ new --
  if (!rfi) {
    const errors = createForm.formState.errors;
    const save = (sendMail: boolean) =>
      createForm.handleSubmit((values) => onCreate(values, { files: createFiles, sendMail }));
    return (
      <SheetShell title={t("buttons.add")} onClose={onClose}>
        <form noValidate onSubmit={save(false)} className="flex flex-col gap-s-4">
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
            labels={recipientLabels}
          />
          {recipientDefaults && (recipientDefaults.name || recipientDefaults.email) && (
            <p className="text-fs-14 text-k-text">{t("screens.s07b.recipientFromContractor")}</p>
          )}
          {/* Owner request 26/11/2026: the letter or e-mail, filed once the RFI exists. */}
          {canWrite && onUpload && (
            <AttachmentField
              id="rfi-attachments"
              label={t("screens.s07b.attachLabel")}
              hint={t("screens.s07b.attachHint")}
              files={createFiles}
              onChange={setCreateFiles}
              disabled={saving}
            />
          )}
          {apiError && (
            <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
              {apiError}
            </p>
          )}
          <SaveButtons
            idPrefix="rfi"
            saving={saving}
            canSendMail={!!contractFacts}
            hasRecipient={recipientEmailTyped.trim() !== ""}
            onSaveAndSend={() => void save(true)()}
          />
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
            labels={recipientLabels}
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
            if (await onAnswer(values, answerFiles)) {
              setAnswerFiles([]);
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
          {/* Owner request 26/11/2026: the contractor's reply as it arrived. Optional. */}
          {onUpload && (
            <AttachmentField
              id="rfi-reply-attachments"
              label={t("screens.s07b.replyAttachLabel")}
              hint={t("screens.s07b.replyAttachHint")}
              files={answerFiles}
              onChange={setAnswerFiles}
              disabled={saving}
            />
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

  // Owner UAT 25/11/2026: «Αποστολή με e-mail» opens Outlook with the RFI
  // written out (`rfi-mail.ts`); eCapital itself sends nothing.
  const canMail = canWrite && rfi.status !== "CLOSED" && !!contractFacts;
  const recipientEmail = rfi.recipientEmail?.trim() ?? "";
  const mailHref =
    canMail && recipientEmail
      ? mailtoHref(
          buildRfiMail(
            {
              number: rfi.number,
              questionEl: rfi.questionEl,
              recipientEmail,
              slaDueAt: rfi.slaDueAt,
              ...contractFacts,
            },
            (key, values) => t(`screens.s07b.email.${key}`, values),
          ),
        )
      : undefined;
  const canMarkSent = canEdit && !!onMarkSent && rfi.sentOn !== today;

  async function markSentToday(): Promise<boolean> {
    if (!onMarkSent) return false;
    const saved = await onMarkSent(today);
    if (saved) setNotice(t("components.correspondence.mail.sentSaved"));
    return saved;
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

      {(notice || filingReport?.draftFile) && (
        <div role="status" className="mt-s-4 grid gap-s-1 rounded-k border border-k-grey bg-k-surface p-s-3 text-fs-14 text-k-ink">
          {notice && <p>{notice}</p>}
          {/* Owner request 26/11/2026: the Outlook draft has been downloaded. */}
          {!notice && filingReport?.draftFile && (
            <>
              <p>{t("screens.s07b.savedAndSent")}</p>
              <p>{t("components.correspondence.mail.draftDownloaded", { file: filingReport.draftFile })}</p>
            </>
          )}
        </div>
      )}
      {filingReport?.draftError && (
        <p role="alert" className="mt-s-4 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {t("components.correspondence.mail.draftFailed", { reason: filingReport.draftError })}
        </p>
      )}

      {(canEdit || canAnswer || canCloseRfi) && (
        <div className="mt-s-4 flex flex-wrap items-center gap-s-3">
          {canAnswer && (
            <button
              type="button"
              onClick={() => {
                answerForm.reset({ answerEl: "", answeredOn: today });
                setAnswerFiles([]);
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

      {canMail && (
        <MailtoPanel
          idPrefix="rfi"
          href={mailHref}
          canMarkSent={canMarkSent}
          onMarkSent={markSentToday}
          saving={saving}
          today={today}
          onOpened={() => setNotice(undefined)}
        />
      )}

      {rfi.status === "CLOSED" && canWrite && <p className="mt-s-4 text-fs-14 text-k-text">{t("screens.s07b.closedNoEdit")}</p>}

      {apiError && (
        <p role="alert" className="mt-s-4 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {apiError}
        </p>
      )}

      {/* Owner decision 25/11/2026: the correspondence — the e-mail sent from
          Outlook and the reply — filed against the RFI and queued for
          eArchive. Attaching stays open after the RFI closes: a late reply
          still belongs on it. */}
      <CorrespondenceSection
        idPrefix="rfi"
        documents={documents}
        onUpload={canWrite ? onUpload : undefined}
        uploading={uploading}
        uploadError={uploadError}
        hint={t("screens.s07b.evidence.hint")}
        failures={filingReport?.failures}
      />
    </SheetShell>
  );
}
