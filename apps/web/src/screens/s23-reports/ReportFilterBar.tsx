"use client";

// S23a — R39 (ADR-0032 §1)
//
/**
 * ReportFilterBar — the filters one report takes, built from its catalogue
 * flags and nothing else: the unit (the caller's own units, after «ΟΚΥπΥ —
 * όλες οι μονάδες»), the year, or a period with S22's quarter presets.
 *
 * | Prop     | Type                 | Notes                                                  |
 * |----------|----------------------|--------------------------------------------------------|
 * | entry    | ReportCatalogueEntry | `takesUnit`, `takesYear`, `takesPeriod` decide.        |
 * | orgUnits | OrgUnit[]            | GET /org-units — the units the caller may see (R01).   |
 * | query    | ReportQuery          | `to` exclusive, like the API's; shown inclusive.       |
 * | onQuery  | (q) => void          |                                                        |
 * | today    | string               | `YYYY-MM-DD`, Nicosia — the year list and the presets. |
 *
 * `takesAgreement` is in the contract but no report sets it today; the bar
 * draws no agreement picker until one does.
 */
import { useLocale, useTranslations } from "next-intl";
import type { OrgUnit, ReportCatalogueEntry, ReportQuery } from "@ecapital/shared";
import type { Locale } from "@/i18n/config";
import { quarter, shiftDay } from "@/screens/s22-scorecard/period";

export interface ReportFilterBarProps {
  entry: ReportCatalogueEntry;
  orgUnits: OrgUnit[];
  query: ReportQuery;
  onQuery: (next: ReportQuery) => void;
  today: string;
}

const inputClass = "min-h-[44px] rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink";

/** This year and the next back to five years ago: a programme is planned a year ahead and read back for audit. */
export function yearOptions(today: string): number[] {
  const year = Number(today.slice(0, 4));
  return Array.from({ length: 7 }, (_, i) => year + 1 - i);
}

export function ReportFilterBar({ entry, orgUnits, query, onQuery, today }: ReportFilterBarProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const current = quarter(today, 0);
  const previous = quarter(today, -1);
  const preset =
    query.from === current.from && query.to === current.to ? "current" : query.from === previous.from && query.to === previous.to ? "previous" : "custom";

  return (
    <div role="group" aria-label={t("screens.s23a.filters.title")} className="mb-s-5 flex flex-wrap items-end gap-s-4 print:hidden">
      {entry.takesUnit && (
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
          {t("common.unit")}
          <select value={query.orgUnitId ?? ""} onChange={(e) => onQuery({ ...query, orgUnitId: e.target.value || undefined })} className={inputClass}>
            <option value="">{t("common.allOkypy")}</option>
            {orgUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {locale === "en" ? u.nameEn : u.nameEl}
              </option>
            ))}
          </select>
        </label>
      )}
      {entry.takesYear && (
        <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
          {t("screens.s23a.filters.year")}
          <select value={query.year ?? ""} onChange={(e) => onQuery({ ...query, year: Number(e.target.value) })} className={`num text-left ${inputClass}`}>
            {yearOptions(today).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      )}
      {entry.takesPeriod && (
        <fieldset className="flex flex-wrap items-end gap-s-2">
          <legend className="mb-s-1 text-fs-14 text-k-text">{t("screens.s23a.filters.period")}</legend>
          {(
            [
              ["current", current],
              ["previous", previous],
            ] as const
          ).map(([key, p]) => (
            <button
              key={key}
              type="button"
              aria-pressed={preset === key}
              onClick={() => onQuery({ ...query, from: p.from, to: p.to })}
              className={`min-h-[44px] rounded-k-chip border px-s-3 text-fs-14 ${preset === key ? "border-k-blue-deep bg-k-blue-bg text-k-ink" : "border-k-grey bg-k-white text-k-text"}`}
            >
              {t(`screens.s23a.filters.presets.${key}`)}
            </button>
          ))}
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t("screens.s23a.filters.from")}
            <input
              type="date"
              value={query.from ?? ""}
              onChange={(e) => e.target.value && onQuery({ ...query, from: e.target.value })}
              className={`num ${inputClass}`}
            />
          </label>
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t("screens.s23a.filters.to")}
            <input
              type="date"
              value={query.to ? shiftDay(query.to, -1) : ""}
              onChange={(e) => e.target.value && onQuery({ ...query, to: shiftDay(e.target.value, 1) })}
              className={`num ${inputClass}`}
            />
          </label>
        </fieldset>
      )}
    </div>
  );
}
