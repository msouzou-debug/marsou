"use client";

// S10 — R14
//
/**
 * UploadCard — the file drop/pick card at the top of S10's batch list
 * (build brief §5 S10). One filled-blue primary per view: «Δοκιμαστική
 * εκτέλεση» is the secondary (outline) action, «Εισαγωγή» is the primary —
 * a dry run is what most visits here are for, so it comes first, but the
 * real import is still the one action this view is ultimately for.
 *
 * | Prop         | Type                                                            | Notes |
 * |--------------|-----------------------------------------------------------------|-------|
 * | canImport    | boolean                                                          | `canImportSap(roles)` — the whole card renders nothing otherwise. |
 * | submitting   | boolean                                                          | Disables both buttons and the file picker. |
 * | apiError     | string?                                                          |       |
 * | dryRunResult | `{ matched, total, exceptions }`? \| null                       | Set after a dry run; cleared once a real import starts. |
 * | onSubmit     | (file, report, period, dryRun) => void                           |       |
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, Upload } from "lucide-react";
import type { SapReport } from "@ecapital/shared";
import { SapReport as SapReportSchema } from "@ecapital/shared";

export interface DryRunResult {
  matched: number;
  total: number;
  exceptions: string[];
}

export interface UploadCardProps {
  canImport: boolean;
  submitting?: boolean;
  apiError?: string;
  dryRunResult?: DryRunResult | null;
  onSubmit: (file: File, report: SapReport, period: string, dryRun: boolean) => void;
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function UploadCard({ canImport, submitting = false, apiError, dryRunResult, onSubmit }: UploadCardProps) {
  const t = useTranslations();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<SapReport>("ME2N");
  const [period, setPeriod] = useState(currentPeriod());
  const [fileMissing, setFileMissing] = useState(false);

  if (!canImport) return null;

  function submit(dryRun: boolean) {
    if (!file) {
      setFileMissing(true);
      return;
    }
    setFileMissing(false);
    onSubmit(file, report, period, dryRun);
  }

  return (
    <section className="mb-s-5 rounded-k border border-k-grey bg-k-white p-s-4">
      <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s10.upload.title")}</h2>

      <div className="mt-s-3 grid gap-s-4 tablet:grid-cols-3">
        <div className="flex flex-col gap-s-1 tablet:col-span-1">
          <label htmlFor="s10-file" className="text-fs-14 text-k-text">
            {t("screens.s10.upload.file")}
          </label>
          <input
            id="s10-file"
            type="file"
            disabled={submitting}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="rounded-k border border-k-grey px-s-2 py-s-2 text-fs-14 text-k-ink"
          />
          {fileMissing && (
            <p role="alert" className="text-fs-14 text-k-red">
              {t("screens.s10.upload.fileRequired")}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="s10-report" className="text-fs-14 text-k-text">
            {t("screens.s10.upload.report")}
          </label>
          <select
            id="s10-report"
            value={report}
            disabled={submitting}
            onChange={(e) => setReport(e.target.value as SapReport)}
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-ink"
          >
            {SapReportSchema.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-s-1">
          <label htmlFor="s10-period" className="text-fs-14 text-k-text">
            {t("screens.s10.upload.period")}
          </label>
          <input
            id="s10-period"
            type="month"
            value={period}
            disabled={submitting}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-11 rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
          />
        </div>
      </div>

      {apiError && (
        <p role="alert" className="mt-s-3 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {apiError}
        </p>
      )}

      {dryRunResult && (
        <div className="mt-s-3 rounded-k border border-k-grey bg-k-surface p-s-3">
          <p className="text-fs-14 text-k-ink">
            {t("screens.s10.upload.dryRunResult", { matched: dryRunResult.matched, total: dryRunResult.total })}
          </p>
          {dryRunResult.exceptions.length > 0 && (
            <>
              <p className="mt-s-2 text-fs-12 font-bold text-k-text">{t("screens.s10.upload.exceptionsTitle")}</p>
              <ul className="mt-s-1 grid gap-s-1 text-fs-12 text-k-text">
                {dryRunResult.exceptions.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="mt-s-4 flex flex-wrap items-center gap-s-3">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={submitting}
          className="flex h-11 items-center justify-center gap-s-2 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
        >
          {submitting && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
          {t("screens.s10.upload.dryRun")}
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={submitting}
          className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
        >
          <Upload size={20} strokeWidth={1.5} aria-hidden="true" />
          {t("screens.s10.upload.import")}
        </button>
      </div>
    </section>
  );
}
