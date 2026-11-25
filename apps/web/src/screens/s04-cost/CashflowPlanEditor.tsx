"use client";

// S04 — R17, ADR-0037
//
/**
 * CashflowPlanEditor — «Επεξεργασία πλάνου»: the project's monthly cash-flow
 * plan as a list of months between two pickers, one amount and one note per
 * month, the plan's total, the approved budget and the difference between
 * them, and the Excel round trip («Λήψη προτύπου», «Εισαγωγή από Excel»).
 *
 * A month with no amount is not in the plan. Save sends the whole plan
 * (`PUT … mode: "replace"`), months outside the window included, so moving
 * the pickers never loses a month.
 *
 * RULE (owner): the plan's total may differ from the approved budget. The
 * difference is shown, never enforced.
 *
 * RULE (owner): the import is all or nothing — the API answers with every
 * bad row and saves nothing, and this lists them by the sheet's row number.
 *
 * Mounted only for `canManageBudgetLines` (ADR-0037: the same people who
 * write the budget lines write the plan).
 *
 * | Prop          | Type                                               | Notes                                             |
 * |---------------|----------------------------------------------------|---------------------------------------------------|
 * | plan          | CashflowPlan                                       | As stored; the draft starts from it.              |
 * | from / to     | string                                             | "YYYY-MM": the section's window, the default when the plan is empty. |
 * | onSave        | (months) => Promise<void>                          | Resolves when saved; throws `ApiError` to show its message. |
 * | onCancel      | () => void                                         |                                                   |
 * | onImport      | (file) => Promise<CashflowPlanImportResult>        | POST …/cashflow-plan/import (multipart).          |
 * | templateHref  | (from, to) => string                               | GET …/cashflow-plan/template.xlsx for the window. |
 */
import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Upload } from "lucide-react";
import type { CashflowPlan, CashflowPlanImportResult, CashflowPlanMonth } from "@ecapital/shared";
import { ApiError } from "@/data/client";
import { formatEUR, formatPeriod, parseAmountInput } from "@/lib/format";

export interface CashflowPlanEditorProps {
  plan: CashflowPlan;
  from: string;
  to: string;
  onSave: (months: CashflowPlanMonth[]) => Promise<void>;
  onCancel: () => void;
  onImport: (file: File) => Promise<CashflowPlanImportResult>;
  templateHref: (from: string, to: string) => string;
}

interface DraftMonth {
  amount: string;
  note: string;
}

/** The longest window the list draws: ten years of months. */
const MAX_MONTHS = 120;

/** Every YYYY-MM from `from` to `to`, inclusive, at most `MAX_MONTHS`. */
export function monthsBetween(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || to < from) return [];
  const periods: string[] = [];
  let [year, month] = from.split("-").map(Number);
  while (periods.length < MAX_MONTHS) {
    const period = `${year}-${String(month).padStart(2, "0")}`;
    if (period > to) break;
    periods.push(period);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return periods;
}

function amountText(amount: number): string {
  return amount.toFixed(2).replace(".", ",").replace(/,00$/, "");
}

function draftOf(plan: CashflowPlan): Record<string, DraftMonth> {
  const draft: Record<string, DraftMonth> = {};
  for (const month of plan.months) draft[month.period] = { amount: amountText(month.amount), note: month.note ?? "" };
  return draft;
}

export function CashflowPlanEditor({ plan, from: windowFrom, to: windowTo, onSave, onCancel, onImport, templateHref }: CashflowPlanEditorProps) {
  const t = useTranslations();
  // The section's window, stretched to take in every month of the plan.
  const [from, setFrom] = useState(() => [windowFrom, plan.months[0]?.period ?? windowFrom].sort()[0]);
  const [to, setTo] = useState(() => [windowTo, plan.months[plan.months.length - 1]?.period ?? windowTo].sort()[1]);
  const [draft, setDraft] = useState<Record<string, DraftMonth>>(() => draftOf(plan));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<CashflowPlanImportResult | null>(null);

  const periods = useMemo(() => monthsBetween(from, to), [from, to]);

  // Every month with something typed in it, valid or not.
  const entries = Object.entries(draft).filter(([, month]) => month.amount.trim() !== "");
  const invalid = new Set(
    entries.filter(([, month]) => {
      const value = parseAmountInput(month.amount);
      return value === null || value < 0;
    }).map(([period]) => period),
  );
  const total = Math.round(
    entries.reduce((sum, [period, month]) => (invalid.has(period) ? sum : sum + (parseAmountInput(month.amount) ?? 0)), 0) * 100,
  ) / 100;
  const difference = Math.round((total - plan.approvedBudget) * 100) / 100;
  const shown = new Set(periods);
  const outside = entries.filter(([period]) => !shown.has(period)).length;

  function update(period: string, field: keyof DraftMonth, value: string) {
    setDraft((current) => ({ ...current, [period]: { ...(current[period] ?? { amount: "", note: "" }), [field]: value } }));
  }

  async function save() {
    if (invalid.size > 0) {
      setError(t("screens.s04.cashflowPlan.fixErrors"));
      return;
    }
    const months: CashflowPlanMonth[] = entries
      .map(([period, month]) => ({
        period,
        amount: parseAmountInput(month.amount) ?? 0,
        note: month.note.trim() === "" ? null : month.note.trim(),
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
    setSaving(true);
    setError(undefined);
    try {
      await onSave(months);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function runImport() {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setError(undefined);
    try {
      const result = await onImport(file);
      setImportResult(result);
      if (result.saved && result.plan) {
        setDraft(draftOf(result.plan));
        if (result.plan.months.length) {
          setFrom(result.plan.months[0].period);
          setTo(result.plan.months[result.plan.months.length - 1].period);
        }
      }
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (importError) {
      setError(importError instanceof ApiError ? importError.message : String(importError));
    } finally {
      setImporting(false);
    }
  }

  const inputClass = "h-9 rounded-k border border-k-grey px-s-2 text-fs-14 text-k-ink";

  return (
    <div className="mt-s-4 grid gap-s-4 border-t border-k-grey pt-s-4" data-testid="cashflow-plan-editor">
      <div className="grid gap-s-2">
        <h3 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s04.cashflowPlan.title")}</h3>
        <p className="text-fs-14 text-k-text">{t("screens.s04.cashflowPlan.intro")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-s-3">
        <div className="flex flex-col gap-s-1">
          <label htmlFor="cashflow-plan-from" className="text-fs-12 text-k-text">
            {t("screens.s04.cashflow.from")}
          </label>
          <input id="cashflow-plan-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </div>
        <div className="flex flex-col gap-s-1">
          <label htmlFor="cashflow-plan-to" className="text-fs-12 text-k-text">
            {t("screens.s04.cashflow.to")}
          </label>
          <input id="cashflow-plan-to" type="month" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-fs-14">
          <caption className="sr-only">{t("screens.s04.cashflowPlan.caption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-k-grey px-s-2 py-s-1 text-left font-bold text-k-blue-deep">
                {t("screens.s04.cashflowPlan.columns.month")}
              </th>
              <th scope="col" className="num border-b border-k-grey px-s-2 py-s-1 font-bold text-k-blue-deep">
                {t("screens.s04.cashflowPlan.columns.amount")}
              </th>
              <th scope="col" className="border-b border-k-grey px-s-2 py-s-1 text-left font-bold text-k-blue-deep">
                {t("screens.s04.cashflowPlan.columns.note")}
              </th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              const month = draft[period] ?? { amount: "", note: "" };
              const bad = invalid.has(period);
              const label = formatPeriod(period);
              return (
                <tr key={period}>
                  <th scope="row" className="border-b border-k-grey px-s-2 py-s-1 text-left font-normal text-k-ink">
                    {label}
                  </th>
                  <td className="border-b border-k-grey px-s-2 py-s-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${t("screens.s04.cashflowPlan.columns.amount")} ${label}`}
                      aria-invalid={bad || undefined}
                      value={month.amount}
                      onChange={(e) => update(period, "amount", e.target.value)}
                      className={`num w-40 ${inputClass} ${bad ? "border-k-red" : ""}`}
                    />
                    {bad && <p className="text-fs-12 text-k-red">{t("screens.s04.cashflowPlan.amountNotValid")}</p>}
                  </td>
                  <td className="border-b border-k-grey px-s-2 py-s-1">
                    <input
                      type="text"
                      maxLength={500}
                      aria-label={`${t("screens.s04.cashflowPlan.columns.note")} ${label}`}
                      value={month.note}
                      onChange={(e) => update(period, "note", e.target.value)}
                      className={`w-full ${inputClass}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold text-k-ink">
              <th scope="row" className="border-t-2 border-k-ink px-s-2 py-s-2 text-left">
                {t("screens.s04.cashflowPlan.total")}
              </th>
              <td className="num border-t-2 border-k-ink px-s-2 py-s-2" data-testid="cashflow-plan-total">
                {formatEUR(total)}
              </td>
              <td className="border-t-2 border-k-ink px-s-2 py-s-2" />
            </tr>
            <tr className="text-k-ink">
              <th scope="row" className="px-s-2 py-s-1 text-left font-normal">
                {t("screens.s04.cashflowPlan.approved")}
              </th>
              <td className="num px-s-2 py-s-1" data-testid="cashflow-plan-approved">
                {formatEUR(plan.approvedBudget)}
              </td>
              <td />
            </tr>
            <tr className="text-k-ink">
              <th scope="row" className="px-s-2 py-s-1 text-left font-normal">
                {t("screens.s04.cashflowPlan.difference")}
              </th>
              {/* RULE (owner): shown, never enforced. Red when the plan spends more than was approved. */}
              <td className={`num px-s-2 py-s-1 ${difference > 0 ? "text-k-red" : ""}`} data-testid="cashflow-plan-difference">
                {formatEUR(difference)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {outside > 0 && <p className="text-fs-14 text-k-text">{t("screens.s04.cashflowPlan.outside", { count: outside })}</p>}

      {error && (
        <p role="alert" className="text-fs-14 text-k-red">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-s-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="flex min-h-[44px] items-center rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
        >
          {saving ? t("screens.s04.cashflowPlan.saving") : t("buttons.save")}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="flex min-h-[44px] items-center rounded-k border border-k-grey px-s-4 text-fs-14 text-k-blue-deep disabled:opacity-60"
        >
          {t("buttons.cancel")}
        </button>
      </div>

      <div className="grid gap-s-3 border-t border-k-grey pt-s-4">
        <h4 className="text-fs-14 font-bold text-k-blue-deep">{t("screens.s04.cashflowPlan.importExcel")}</h4>
        <p className="text-fs-14 text-k-text">{t("screens.s04.cashflowPlan.importIntro")}</p>
        <div className="flex flex-wrap items-center gap-s-3">
          <a href={templateHref(from, to)} className="flex min-h-[44px] items-center gap-s-2 rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep">
            <Download size={20} strokeWidth={1.5} aria-hidden="true" />
            {t("screens.s04.cashflowPlan.downloadTemplate")}
          </a>
          <label className="flex min-h-[44px] items-center gap-s-2 text-fs-14 text-k-text">
            {t("screens.s04.cashflowPlan.importFile")}
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-fs-14"
            />
          </label>
          <button
            type="button"
            disabled={!file || importing}
            onClick={() => void runImport()}
            className="flex min-h-[44px] items-center gap-s-2 rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep disabled:opacity-60"
          >
            <Upload size={20} strokeWidth={1.5} aria-hidden="true" />
            {importing ? t("screens.s04.cashflowPlan.importing") : t("screens.s04.cashflowPlan.importExcel")}
          </button>
        </div>

        {importResult && (
          <div role="status" className="grid gap-s-2">
            {importResult.saved ? (
              <p className="text-fs-14 text-k-ink">
                {t("screens.s04.cashflowPlan.importSaved", { count: importResult.plan?.months.length ?? 0 })}
              </p>
            ) : (
              <>
                <p className="text-fs-14 text-k-red">{t("screens.s04.cashflowPlan.importFailed")}</p>
                <table className="w-full border-collapse text-fs-14">
                  <caption className="sr-only">{t("screens.s04.cashflowPlan.importErrorsCaption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="num border-b border-k-grey px-s-2 py-s-1 font-bold text-k-blue-deep">
                        {t("screens.s04.cashflowPlan.row")}
                      </th>
                      <th scope="col" className="border-b border-k-grey px-s-2 py-s-1 text-left font-bold text-k-blue-deep">
                        {t("screens.s04.cashflowPlan.problem")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.errors.map((e) => (
                      <tr key={`${e.row}-${e.problem}`}>
                        <td className="num border-b border-k-grey px-s-2 py-s-1">
                          {e.row > 0 ? e.row : t("screens.s04.cashflowPlan.wholeFile")}
                        </td>
                        <td className="border-b border-k-grey px-s-2 py-s-1">
                          {t(`screens.s04.cashflowPlan.problems.${e.problem}`, { value: e.value ?? "" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
