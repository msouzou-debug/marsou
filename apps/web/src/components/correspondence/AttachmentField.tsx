"use client";

/**
 * AttachmentField — one or more files picked on a form, kept until the form
 * is saved (owner request 26/11/2026: «attach e-mail/letter document and
 * save»). The RFI's new and answer forms and the site instruction's new form
 * use it; the files are filed against the record once it exists
 * (`fileEach`) and, on «Αποθήκευση και αποστολή e-mail», travel in the
 * Outlook draft (`@/lib/mail-draft`).
 *
 * | Prop     | Type                     | Notes                                                    |
 * |----------|--------------------------|-----------------------------------------------------------|
 * | id       | string                   | The file input's id; `label` points at it.                 |
 * | label    | string                   | Already translated.                                        |
 * | hint     | string?                  | Under the label. The limits line always follows it.        |
 * | files    | File[]                   | Controlled.                                                |
 * | onChange | (files: File[]) => void  |                                                            |
 * | accept   | string?                  | Default `CORRESPONDENCE_ACCEPT`, the RFI upload's list.     |
 * | maxBytes | number?                  | Default 50 MB, eArchive's limit per file.                   |
 * | disabled | boolean?                 | While the form saves.                                       |
 *
 * RULES: a file over the limit, or an empty one, is not added and the field
 * says which and why (role=alert) — the API would refuse it after the record
 * was saved. The same file picked twice is listed once. Each listed file has
 * its own «Αφαίρεση».
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Paperclip, X } from "lucide-react";
import { formatFileSize } from "@/lib/format";

/** What the RFI correspondence upload has accepted since 25/11/2026: Outlook's .msg, .eml and PDF. */
export const CORRESPONDENCE_ACCEPT = ".msg,.eml,.pdf,application/pdf,message/rfc822,application/vnd.ms-outlook";
/** eArchive's limit per file (apps/api/src/documents/earchive-contract.ts `MAX_FILE_BYTES`). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export interface AttachmentFieldProps {
  id: string;
  label: string;
  hint?: string;
  files: File[];
  onChange: (files: File[]) => void;
  accept?: string;
  maxBytes?: number;
  disabled?: boolean;
}

const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

export function AttachmentField({
  id,
  label,
  hint,
  files,
  onChange,
  accept = CORRESPONDENCE_ACCEPT,
  maxBytes = MAX_ATTACHMENT_BYTES,
  disabled = false,
}: AttachmentFieldProps) {
  const t = useTranslations("components.correspondence.attachments");
  const [refused, setRefused] = useState<string[]>([]);

  function add(picked: FileList | null) {
    const next = [...files];
    const problems: string[] = [];
    for (const file of Array.from(picked ?? [])) {
      if (file.size === 0) problems.push(t("empty", { name: file.name }));
      else if (file.size > maxBytes) problems.push(t("tooLarge", { name: file.name, limit: formatFileSize(maxBytes) }));
      else if (!next.some((existing) => sameFile(existing, file))) next.push(file);
    }
    setRefused(problems);
    if (next.length !== files.length) onChange(next);
  }

  return (
    <div className="flex flex-col gap-s-1">
      <label htmlFor={id} className="text-fs-14 text-k-text">
        {label}
      </label>
      {hint && <p className="text-fs-14 text-k-text">{hint}</p>}
      <p id={`${id}-limits`} className="text-fs-14 text-k-text">
        {t("limits", { limit: formatFileSize(maxBytes) })}
      </p>
      <input
        id={id}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        aria-describedby={`${id}-limits`}
        onChange={(event) => {
          add(event.target.files);
          // The same file can be picked again after it was removed.
          event.target.value = "";
        }}
        className="text-fs-14 text-k-ink"
      />
      {refused.map((problem) => (
        <p key={problem} role="alert" className="text-fs-14 text-k-red">
          {problem}
        </p>
      ))}
      {files.length > 0 && (
        <ul aria-label={t("chosen")} className="mt-s-1 grid gap-s-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="flex items-center justify-between gap-s-2 rounded-k border border-k-grey px-s-3 py-s-1 text-fs-14 text-k-ink"
            >
              <span className="flex min-w-0 items-center gap-s-2">
                <Paperclip size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-k-text" />
                <span className="truncate">{file.name}</span>
                <span className="num shrink-0 text-k-text">{formatFileSize(file.size)}</span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                className="flex h-11 shrink-0 items-center gap-s-1 rounded-k px-s-2 text-fs-14 text-k-blue disabled:opacity-60"
              >
                <X size={16} strokeWidth={1.5} aria-hidden="true" />
                {t("remove")}
                <span className="sr-only"> {file.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
