"use client";

// S07c — R09 (ADR-0017)
//
/**
 * InstructionSheet — the row-open sheet for one site instruction, or the
 * "new" form (`instruction` omitted).
 *
 * - no `instruction` → the **new** form (text, issue day, cost-impact
 *   checkbox). The issue day defaults to today and may be earlier: an
 *   instruction given on site on Monday is often typed in on Wednesday.
 * - existing → the **read view**: number, full text, who issued it and when,
 *   cost impact and the linked variation (UAT 25/11/2026 — the row used to
 *   open on Enter only), and the same «Δημιουργία τροποποίησης» action the
 *   table row offers — RULE (ADR-0017): only with cost impact, and only
 *   once; a linked instruction shows the link to its variation instead, and a
 *   costImpactFlag with no variation and no write access shows neither.
 * - «Επεξεργασία» (writers, and only when `onUpdate` is wired) → the **edit
 *   form**, the same fields as the new one. RULE (R09, UAT 25/11/2026): not
 *   once the instruction has become a variation — the variation is the record
 *   of what it cost from then on (the API: errors.siteInstructionSettled).
 * - RULE (owner, UAT 25/11/2026): the issue day is not after today, said
 *   under the field before the API says it again (errors.dateInFuture).
 *
 * Owner request 26/11/2026 («site instructions need same facility to send
 * e-mails as RFI») — everything the RFI sheet has but the answer, because an
 * instruction is one-way:
 * - the new and edit forms gain the recipient, their e-mail and the day it
 *   was sent (all optional; the new form starts from the contractor's
 *   contact, `recipientDefaults`). RULE: the sent day is not after today and
 *   not before the issue day.
 * - the new form gains the optional attachment field (online writers only,
 *   `onUpload`) and «Αποθήκευση και αποστολή e-mail»: save, today as the sent
 *   day, and an Outlook draft (.eml) with the files attached. Disabled, with
 *   the reason under it, while no recipient e-mail is filled in.
 * - the read view gains the recipient and sent day, «Αποστολή με e-mail»
 *   (`mailto:`) with the one-click «sent today» (only while it can still be
 *   edited), and «Αλληλογραφία» with its upload (`CorrespondenceSection`),
 *   which also reports the files a save could not file (`filingReport`).
 *
 * | Prop            | Type                              | Notes                                    |
 * |-----------------|-----------------------------------|--------------------------------------------|
 * | open            | boolean                           |                                              |
 * | instruction     | SiteInstruction?                  | Omit for the "new" form.                    |
 * | variationNumber | number?                           | The linked variation's own number, if any.  |
 * | canWrite        | boolean                           | `canWriteSiteInstructions(roles)`.          |
 * | creatingVariation | boolean?                        |                                              |
 * | saving          | boolean?                          |                                              |
 * | apiError        | string?                           |                                              |
 * | onClose         | () => void                        |                                              |
 * | onCreate        | (values, options) => void         | `options.files` to file, `options.sendMail` for the Outlook draft. |
 * | onCreateVariation | () => void                      |                                              |
 * | onUpdate        | (values) => Promise<boolean>?     | `PATCH`; true on success, which returns the sheet to the read view. |
 * | recipientDefaults | { name, email }?                | The contractor's contact, prefilled on the new form. |
 * | documents       | SiteInstructionDocument[]?        | Undefined while loading.                     |
 * | onUpload        | (file, titleEl) => Promise<boolean>? | Omitted (or offline): no upload and no attachment field. |
 * | uploading / uploadError | —                         |                                              |
 * | filingReport    | FilingReport?                     | What happened to the new form's files and draft. |
 * | contractFacts   | ContractMailFacts?                | Omitted: no e-mail buttons.                  |
 * | onMarkSent      | (sentOn) => Promise<boolean>?     | `PATCH` `{ sentOn }`, the one-click «sent today». |
 * | today           | string?                           | yyyy-mm-dd in Nicosia; injectable for tests. |
 */
import { useState } from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { nicosiaDateOf, type SiteInstruction, type SiteInstructionDocument } from "@ecapital/shared";
import { zodResolver } from "@/lib/zod-resolver";
import { formatDate } from "@/lib/format";
import type { ContractMailFacts } from "@/lib/contract-recipient";
import type { FilingReport } from "@/lib/file-each";
import { mailtoHref } from "@/lib/mail-draft";
import {
  AttachmentField,
  CorrespondenceSection,
  MailtoPanel,
  RecipientFields,
  SaveButtons,
} from "@/components/correspondence";
import { InstructionFormSchema, type InstructionFormValues } from "./schema";
import { buildInstructionMail } from "./instruction-mail";
import { SideSheet } from "@/components/side-sheet";

/** Owner request 26/11/2026: what the new form hands the screen besides the values. */
export interface InstructionSaveOptions {
  files: File[];
  sendMail: boolean;
}

export interface InstructionSheetProps {
  open: boolean;
  instruction?: SiteInstruction;
  variationNumber?: number;
  canWrite: boolean;
  creatingVariation?: boolean;
  saving?: boolean;
  apiError?: string;
  onClose: () => void;
  onCreate: (values: InstructionFormValues, options: InstructionSaveOptions) => void;
  onCreateVariation: () => void;
  onUpdate?: (values: InstructionFormValues) => Promise<boolean>;
  recipientDefaults?: { name: string; email: string };
  documents?: SiteInstructionDocument[];
  onUpload?: (file: File, titleEl: string) => Promise<boolean>;
  uploading?: boolean;
  uploadError?: string;
  filingReport?: FilingReport;
  contractFacts?: ContractMailFacts;
  onMarkSent?: (sentOn: string) => Promise<boolean>;
  today?: string;
}

// OWNER UAT 25/11/2026: the shared sheet — above the top bar and the
// table's sticky header, with «Πίσω στη λίστα», Escape and the backdrop as
// its ways out (`components/side-sheet`).
const SheetShell = SideSheet;

function valuesOf(
  instruction: SiteInstruction | undefined,
  today: string,
  recipientDefaults?: { name: string; email: string },
): InstructionFormValues {
  return instruction
    ? {
        textEl: instruction.textEl,
        costImpactFlag: instruction.costImpactFlag,
        issuedOn: nicosiaDateOf(instruction.issuedAt),
        recipientName: instruction.recipientName ?? "",
        recipientEmail: instruction.recipientEmail ?? "",
        sentOn: instruction.sentOn ?? "",
      }
    : {
        textEl: "",
        costImpactFlag: false,
        issuedOn: today,
        recipientName: recipientDefaults?.name ?? "",
        recipientEmail: recipientDefaults?.email ?? "",
        sentOn: "",
      };
}

/** Text, issue day, cost impact and who it went to — the new form and the edit form are the same fields. */
function InstructionFields({
  form,
  idPrefix,
  today,
}: {
  form: UseFormReturn<InstructionFormValues>;
  idPrefix: string;
  today: string;
}) {
  const t = useTranslations();
  const errors = form.formState.errors;
  const issuedOn = useWatch({ control: form.control, name: "issuedOn" });
  return (
    <>
      <div className="flex flex-col gap-s-1">
        <label htmlFor={`${idPrefix}-text`} className="text-fs-14 text-k-text">
          {t("screens.s07c.fields.text")}
        </label>
        <textarea
          id={`${idPrefix}-text`}
          rows={3}
          {...form.register("textEl")}
          aria-invalid={errors.textEl ? "true" : undefined}
          className="rounded-k border border-k-grey p-s-3 text-fs-14 text-k-ink"
        />
        {errors.textEl && (
          <p role="alert" className="text-fs-14 text-k-red">
            {t(errors.textEl.message as string)}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-s-1">
        <label htmlFor={`${idPrefix}-issued-on`} className="text-fs-14 text-k-text">
          {t("screens.s07c.fields.issuedOn")}
        </label>
        <input
          id={`${idPrefix}-issued-on`}
          type="date"
          max={today}
          {...form.register("issuedOn")}
          aria-invalid={errors.issuedOn ? "true" : undefined}
          className="num h-11 w-[200px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
        />
        {errors.issuedOn && (
          <p role="alert" className="text-fs-14 text-k-red">
            {t(errors.issuedOn.message as string)}
          </p>
        )}
      </div>
      <label className="flex items-center gap-s-2 text-fs-14 text-k-ink">
        <input type="checkbox" {...form.register("costImpactFlag")} />
        {t("screens.s07c.fields.costImpact")}
      </label>
      <RecipientFields
        idPrefix={idPrefix}
        register={form.register}
        errors={{
          recipientName: errors.recipientName?.message,
          recipientEmail: errors.recipientEmail?.message,
          sentOn: errors.sentOn?.message,
        }}
        minSentOn={issuedOn || undefined}
        maxSentOn={today}
        labels={{
          name: t("screens.s07c.fields.recipientName"),
          nameHint: t("screens.s07c.fields.recipientNameHint"),
          email: t("screens.s07c.fields.recipientEmail"),
          sentOn: t("screens.s07c.fields.sentOn"),
          sentOnHint: t("screens.s07c.fields.sentOnHint"),
        }}
      />
    </>
  );
}

export function InstructionSheet({
  open,
  instruction,
  variationNumber,
  canWrite,
  creatingVariation = false,
  saving = false,
  apiError,
  onClose,
  onCreate,
  onCreateVariation,
  onUpdate,
  recipientDefaults,
  documents,
  onUpload,
  uploading = false,
  uploadError,
  filingReport,
  contractFacts,
  onMarkSent,
  today = nicosiaDateOf(new Date()),
}: InstructionSheetProps) {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [files, setFiles] = useState<File[]>([]);
  const form = useForm<InstructionFormValues>({
    resolver: zodResolver<InstructionFormValues>(InstructionFormSchema),
    defaultValues: valuesOf(instruction, today, recipientDefaults),
  });
  const recipientEmailTyped = useWatch({ control: form.control, name: "recipientEmail" }) ?? "";

  if (!open) return null;

  const errorBox = apiError && (
    <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
      {apiError}
    </p>
  );

  if (!instruction) {
    const save = (sendMail: boolean) => form.handleSubmit((values) => onCreate(values, { files, sendMail }));
    return (
      <SheetShell title={t("buttons.add")} onClose={onClose}>
        <form noValidate onSubmit={save(false)} className="flex flex-col gap-s-4">
          <InstructionFields form={form} idPrefix="instr" today={today} />
          {recipientDefaults && (recipientDefaults.name || recipientDefaults.email) && (
            <p className="text-fs-14 text-k-text">{t("screens.s07c.recipientFromContractor")}</p>
          )}
          {canWrite && onUpload && (
            <AttachmentField
              id="instr-attachments"
              label={t("screens.s07c.attachLabel")}
              hint={t("screens.s07c.attachHint")}
              files={files}
              onChange={setFiles}
              disabled={saving}
            />
          )}
          {errorBox}
          <SaveButtons
            idPrefix="instr"
            saving={saving}
            canSendMail={!!contractFacts}
            hasRecipient={recipientEmailTyped.trim() !== ""}
            onSaveAndSend={() => void save(true)()}
          />
        </form>
      </SheetShell>
    );
  }

  const settled = instruction.variationId !== null;
  const canEdit = canWrite && !!onUpdate && !settled;

  if (editing && canEdit) {
    return (
      <SheetShell title={t("screens.s07c.editTitle", { number: instruction.number })} onClose={onClose}>
        <form
          noValidate
          onSubmit={form.handleSubmit(async (values) => {
            if (await onUpdate(values)) setEditing(false);
          })}
          className="flex flex-col gap-s-4"
        >
          <InstructionFields form={form} idPrefix="instr-edit" today={today} />
          {errorBox}
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

  const notRecorded = <span className="text-k-text">{t("screens.s07c.notRecorded")}</span>;
  // Owner request 26/11/2026: «Αποστολή με e-mail», as on the RFI. Sending
  // a copy again stays possible after the instruction became a variation;
  // recording the day is an edit and is not.
  const canMail = canWrite && !!contractFacts;
  const recipientEmail = instruction.recipientEmail?.trim() ?? "";
  const mailHref =
    canMail && contractFacts && recipientEmail
      ? mailtoHref(
          buildInstructionMail(
            {
              number: instruction.number,
              textEl: instruction.textEl,
              recipientEmail,
              issuedAt: instruction.issuedAt,
              ...contractFacts,
            },
            (key, values) => t(`screens.s07c.email.${key}`, values),
          ),
        )
      : undefined;
  const canMarkSent = canEdit && !!onMarkSent && instruction.sentOn !== today;

  async function markSentToday(): Promise<boolean> {
    if (!onMarkSent) return false;
    const saved = await onMarkSent(today);
    if (saved) setNotice(t("components.correspondence.mail.sentSaved"));
    return saved;
  }

  return (
    <SheetShell title={t("screens.s07c.sheetTitle", { number: instruction.number })} onClose={onClose}>
      <dl className="grid gap-s-4 text-fs-14">
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.number")}</dt>
          <dd className="num text-k-ink">{instruction.number}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.text")}</dt>
          <dd className="whitespace-pre-line text-k-ink">{instruction.textEl}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.issuedBy")}</dt>
          <dd className="text-k-ink">{instruction.issuedByName}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.issuedOn")}</dt>
          <dd className="num text-k-ink">{formatDate(instruction.issuedAt)}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.recipientName")}</dt>
          <dd className="text-k-ink">
            {instruction.recipientName ?? notRecorded}
            {instruction.recipientEmail && <span className="block text-k-text">{instruction.recipientEmail}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.sentOn")}</dt>
          <dd className="num text-k-ink">{instruction.sentOn ? formatDate(instruction.sentOn) : notRecorded}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.columns.costImpact")}</dt>
          <dd className="text-k-ink">{instruction.costImpactFlag ? t("common.yes") : t("common.no")}</dd>
        </div>
        <div>
          <dt className="text-k-text">{t("screens.s07c.fields.variation")}</dt>
          <dd className="text-k-ink">
            {settled && variationNumber !== undefined ? t("screens.s07c.variationLink", { number: variationNumber }) : t("common.notAvailable")}
          </dd>
        </div>
      </dl>

      {(notice || filingReport?.draftFile) && (
        <div role="status" className="mt-s-4 grid gap-s-1 rounded-k border border-k-grey bg-k-surface p-s-3 text-fs-14 text-k-ink">
          {notice && <p>{notice}</p>}
          {!notice && filingReport?.draftFile && (
            <>
              <p>{t("screens.s07c.savedAndSent")}</p>
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

      <div className="mt-s-4 flex flex-wrap items-center gap-s-3">
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              form.reset(valuesOf(instruction, today));
              setNotice(undefined);
              setEditing(true);
            }}
            disabled={saving}
            className="h-11 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
          >
            {t("buttons.edit")}
          </button>
        )}
        {!settled && instruction.costImpactFlag && canWrite && (
          <button
            type="button"
            onClick={onCreateVariation}
            disabled={creatingVariation}
            className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
          >
            {creatingVariation && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
            {t("screens.s07c.createVariation")}
          </button>
        )}
      </div>

      {canMail && (
        <MailtoPanel
          idPrefix="instr"
          href={mailHref}
          canMarkSent={canMarkSent}
          onMarkSent={markSentToday}
          saving={saving}
          today={today}
          onOpened={() => setNotice(undefined)}
        />
      )}

      {settled && canWrite && <p className="mt-s-4 text-fs-14 text-k-text">{t("screens.s07c.settledNoEdit")}</p>}

      {apiError && <div className="mt-s-4">{errorBox}</div>}

      {/* Owner request 26/11/2026: the sent e-mail or the letter, filed
          against the instruction and queued for eArchive, as on the RFI. */}
      <CorrespondenceSection
        idPrefix="instr"
        documents={documents}
        onUpload={canWrite ? onUpload : undefined}
        uploading={uploading}
        uploadError={uploadError}
        hint={t("screens.s07c.evidenceHint")}
        failures={filingReport?.failures}
      />
    </SheetShell>
  );
}
