"use client";

/**
 * CorrespondenceSection — «Αλληλογραφία»: the papers filed against one
 * record (an RFI, a site instruction) with «Προβολή» / «Λήψη», and the form
 * that files one more. Lifted out of the RFI sheet (owner decision
 * 25/11/2026) so the site instruction has the same (owner request
 * 26/11/2026).
 *
 * | Prop        | Type                                  | Notes                                               |
 * |-------------|---------------------------------------|------------------------------------------------------|
 * | idPrefix    | string                                | Keeps ids unique on the page.                         |
 * | documents   | CorrespondenceDocument[]?             | Undefined while loading.                              |
 * | onUpload    | (file, titleEl) => Promise<boolean>?  | Omitted (no permission, or offline): no upload form.  |
 * | uploading   | boolean?                              |                                                       |
 * | uploadError | string?                               | The API's refusal of the last upload.                 |
 * | hint        | string                                | What to attach, said by the screen.                   |
 * | failures    | FilingFailure[]?                      | Files a form tried to file after saving the record and could not. |
 *
 * «Προβολή» opens a PDF in a new tab and saves any other type (a .msg or .eml
 * is saved, then opened by Outlook); «Λήψη» always saves (`?download=1`, UAT
 * 25/11/2026). RULE (owner request 26/11/2026): when a form saved the record
 * but a file failed, the section says which file and why, and opens the
 * upload form so it can be attached again here.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import type { RfiDocument } from "@ecapital/shared";
import { documentContentHref, documentViewHref } from "@/data/queries";
import { formatDate } from "@/lib/format";
import { evidenceTitleError, type FilingFailure } from "@/lib/file-each";
import { CORRESPONDENCE_ACCEPT } from "./AttachmentField";

/** The RFI's and the site instruction's papers have one shape. */
export type CorrespondenceDocument = RfiDocument;

export interface CorrespondenceSectionProps {
  idPrefix: string;
  documents?: CorrespondenceDocument[];
  onUpload?: (file: File, titleEl: string) => Promise<boolean>;
  uploading?: boolean;
  uploadError?: string;
  hint: string;
  failures?: FilingFailure[];
}

const INPUT = "h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink";

export function CorrespondenceSection({
  idPrefix,
  documents,
  onUpload,
  uploading = false,
  uploadError,
  hint,
  failures = [],
}: CorrespondenceSectionProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  // A new set of failed files opens the form once, so the retry is one click away.
  const failuresKey = failures.map((f) => f.filename).join("\n");
  const [handledFailures, setHandledFailures] = useState("");
  const formOpen = open || (failuresKey !== "" && failuresKey !== handledFailures);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const titleId = `${idPrefix}-evidence-title`;

  async function submit() {
    if (!file || !onUpload) return;
    const error = evidenceTitleError(title);
    setTitleError(error);
    if (error) return;
    if (await onUpload(file, title.trim())) {
      setFile(null);
      setTitle("");
      setOpen(false);
      setHandledFailures(failuresKey);
    }
  }

  function cancel() {
    setOpen(false);
    setHandledFailures(failuresKey);
    setFile(null);
    setTitle("");
    setTitleError(undefined);
  }

  return (
    <section aria-labelledby={titleId} className="mt-s-6 border-t border-k-grey pt-s-4">
      <h3 id={titleId} className="mb-s-3 text-fs-16 font-bold text-k-blue-deep">
        {t("components.correspondence.title")}
      </h3>

      {failures.length > 0 && (
        <div role="alert" className="mb-s-3 grid gap-s-1 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          <p className="font-bold">{t("components.correspondence.failedTitle")}</p>
          <ul className="grid gap-s-1">
            {failures.map((failure) => (
              <li key={`${failure.filename}-${failure.message}`}>
                {t("components.correspondence.failedLine", { name: failure.filename, reason: failure.message })}
              </li>
            ))}
          </ul>
          {onUpload && <p>{t("components.correspondence.failedRetry")}</p>}
        </div>
      )}

      {documents === undefined ? (
        <p className="text-fs-14 text-k-text-muted">{t("common.loading")}</p>
      ) : documents.length === 0 ? (
        <p className="text-fs-14 text-k-text">{t("components.correspondence.empty")}</p>
      ) : (
        <ul className="grid gap-s-2">
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-s-2 border-b border-k-grey pb-s-2">
              <span className="text-fs-14 text-k-ink">
                {doc.titleEl}
                <span className="num block text-fs-14 text-k-text">
                  {formatDate(doc.createdAt)} · {doc.protocolNumber ?? t("components.correspondence.pendingFiling")}
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

      {onUpload && (
        <div className="mt-s-4">
          {!formOpen ? (
            <button type="button" onClick={() => setOpen(true)} className="h-11 text-fs-14 text-k-blue">
              {t("components.correspondence.upload")}
            </button>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              className="grid gap-s-3"
            >
              <p className="text-fs-14 text-k-text">{hint}</p>
              <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                {t("components.correspondence.file")}
                <input
                  type="file"
                  accept={CORRESPONDENCE_ACCEPT}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="text-fs-14 text-k-ink"
                />
              </label>
              <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                {t("components.correspondence.titleLabel")}
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-invalid={titleError ? "true" : undefined}
                  className={INPUT}
                />
              </label>
              {titleError && (
                <p role="alert" className="text-fs-14 text-k-red">
                  {t(titleError)}
                </p>
              )}
              {uploadError && (
                <p role="alert" className="rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
                  {uploadError}
                </p>
              )}
              <div className="flex items-center gap-s-3">
                <button
                  type="submit"
                  disabled={uploading || !file}
                  className="flex h-11 items-center justify-center gap-s-2 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
                >
                  {uploading && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
                  {uploading ? t("components.correspondence.saving") : t("buttons.save")}
                </button>
                <button type="button" onClick={cancel} disabled={uploading} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60">
                  {t("buttons.cancel")}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
