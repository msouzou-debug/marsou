"use client";

// S10 — ADR-0036
//
/**
 * ConnectorCard — «Λήψη από το SAP»: asks the API to call SAP's capital
 * spending lines read for a fiscal year and a period range, instead of a
 * person uploading a file. Same role gate as `UploadCard` (`canImportSap`).
 *
 * | Prop       | Type                              | Notes                                                    |
 * |------------|-----------------------------------|----------------------------------------------------------|
 * | canImport  | boolean                           | The whole card renders nothing otherwise.                |
 * | submitting | boolean                           | Disables the fields and the button.                      |
 * | notice     | string?                           | The API's sentence when the connector is not set up yet: an info notice, not an alarm. |
 * | apiError   | string?                           | Any other failure.                                       |
 * | today      | string?                           | `YYYY-MM-DD`; the defaults are the previous month. Tests pin it. |
 * | onSubmit   | (params: ConnectorParams) => void |                                                          |
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CloudDownload, Info, LoaderCircle } from "lucide-react";

export interface ConnectorParams {
  fiscalYear: number;
  periodFrom: number;
  periodTo: number;
}

export interface ConnectorCardProps {
  canImport: boolean;
  submitting?: boolean;
  notice?: string;
  apiError?: string;
  today?: string;
  onSubmit: (params: ConnectorParams) => void;
}

/** The previous calendar month, with the year it belongs to (January looks back to December). */
export function previousMonth(today: string): { year: number; month: number } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const inputClass = "h-11 w-full rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink";

export function ConnectorCard({ canImport, submitting = false, notice, apiError, today, onSubmit }: ConnectorCardProps) {
  const t = useTranslations();
  const initial = previousMonth(today ?? todayIso());
  const [year, setYear] = useState(String(initial.year));
  const [from, setFrom] = useState(String(initial.month));
  const [to, setTo] = useState(String(initial.month));
  const [invalid, setInvalid] = useState(false);

  if (!canImport) return null;

  function submit() {
    const fiscalYear = Number(year);
    const periodFrom = Number(from);
    const periodTo = Number(to);
    const ok =
      Number.isInteger(fiscalYear) &&
      fiscalYear >= 2000 &&
      Number.isInteger(periodFrom) &&
      Number.isInteger(periodTo) &&
      periodFrom >= 1 &&
      periodTo <= 16 &&
      periodFrom <= periodTo;
    setInvalid(!ok);
    if (ok) onSubmit({ fiscalYear, periodFrom, periodTo });
  }

  return (
    <section aria-labelledby="s10-connector-title" className="mb-s-5 rounded-k border border-k-grey bg-k-white p-s-4">
      <h2 id="s10-connector-title" className="text-fs-16 font-bold text-k-blue-deep">
        {t("screens.s10.connector.title")}
      </h2>
      <p className="mt-s-1 text-fs-14 text-k-text">{t("screens.s10.connector.intro")}</p>

      <div className="mt-s-3 grid gap-s-4 tablet:grid-cols-3">
        <div className="flex flex-col gap-s-1">
          <label htmlFor="s10-fiscal-year" className="text-fs-14 text-k-text">
            {t("screens.s10.connector.fiscalYear")}
          </label>
          <input id="s10-fiscal-year" type="number" inputMode="numeric" value={year} disabled={submitting} onChange={(e) => setYear(e.target.value)} className={`num ${inputClass}`} />
        </div>
        <div className="flex flex-col gap-s-1">
          <label htmlFor="s10-period-from" className="text-fs-14 text-k-text">
            {t("screens.s10.connector.periodFrom")}
          </label>
          <input id="s10-period-from" type="number" inputMode="numeric" min={1} max={16} value={from} disabled={submitting} onChange={(e) => setFrom(e.target.value)} className={`num ${inputClass}`} />
        </div>
        <div className="flex flex-col gap-s-1">
          <label htmlFor="s10-period-to" className="text-fs-14 text-k-text">
            {t("screens.s10.connector.periodTo")}
          </label>
          <input id="s10-period-to" type="number" inputMode="numeric" min={1} max={16} value={to} disabled={submitting} onChange={(e) => setTo(e.target.value)} className={`num ${inputClass}`} />
        </div>
      </div>

      {invalid && (
        <p role="alert" className="mt-s-3 text-fs-14 text-k-red">
          {t("screens.s10.connector.invalid")}
        </p>
      )}

      {notice && (
        <p role="status" className="mt-s-3 flex items-start gap-s-2 rounded-k border border-k-grey bg-k-surface p-s-3 text-fs-14 text-k-ink">
          <Info size={20} strokeWidth={1.5} aria-hidden="true" className="mt-[2px] shrink-0 text-k-blue-deep" />
          <span>{notice}</span>
        </p>
      )}

      {apiError && (
        <p role="alert" className="mt-s-3 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {apiError}
        </p>
      )}

      <div className="mt-s-4">
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="flex h-11 items-center justify-center gap-s-2 rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep disabled:opacity-60"
        >
          {submitting ? (
            <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />
          ) : (
            <CloudDownload size={20} strokeWidth={1.5} aria-hidden="true" />
          )}
          {t("screens.s10.connector.fetch")}
        </button>
      </div>
    </section>
  );
}
