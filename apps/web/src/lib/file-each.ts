// Owner request 26/11/2026: the files picked on a form are filed once the
// record they belong to exists — an RFI just created, an answer just saved,
// a site instruction just issued.
//
// RULE: the record is never lost because a file failed. Each file is filed
// on its own, one after the other (the API numbers a record's papers in
// order, and eArchive sees them in that order), and every failure is kept
// with the file's name and the API's own sentence, so the screen can say
// which file did not make it and why, and the user can attach it again from
// the read view.
import { ApiError } from "@/data/client";

export interface FilingFailure {
  filename: string;
  /** The API's sentence, already in the user's language, or the error's text. */
  message: string;
}

/**
 * What happened to the files after the record was saved, for the read view:
 * the ones that failed, and the Outlook draft when one was asked for.
 */
export interface FilingReport {
  failures: FilingFailure[];
  /** The .eml downloaded, by name. */
  draftFile?: string;
  /** Why the .eml could not be made. */
  draftError?: string;
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function fileEach(files: File[], upload: (file: File) => Promise<unknown>): Promise<FilingFailure[]> {
  const failures: FilingFailure[] = [];
  for (const file of files) {
    try {
      await upload(file);
    } catch (error) {
      failures.push({ filename: file.name, message: errorText(error) });
    }
  }
  return failures;
}

/** The upload form's title: optional, and at least 3 characters when one is given. A message key or undefined. */
export function evidenceTitleError(title: string): string | undefined {
  const trimmed = title.trim();
  return trimmed !== "" && trimmed.length < 3 ? "forms.titleTooShort" : undefined;
}

/** RULE: the API keeps 3 to 500 characters of a title (0014); «label — file name», cut to fit. */
export function filingTitle(label: string, filename: string): string {
  return `${label} — ${filename}`.slice(0, 500);
}
