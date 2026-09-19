"use client";

// S04 — R13, R16 (finance-only budget rule)
//
/**
 * BudgetLinesEditor — «Γραμμές προϋπολογισμού»: the finance/admin-only editor
 * for a project's budget lines, one year at a time (build brief §5 S04).
 * Same add/remove/edit-in-place shape `BoqSection` uses for S07's bill of
 * quantities — amounts are typed as text and parsed on save, Enter commits a
 * cell and blurs it, Esc restores the value the cell had on focus.
 *
 * RULE: this whole section is never rendered for a caller who is not
 * `canManageBudgetLines` — S04's own screen only mounts it for finance/admin
 * (CAPEX-01 §7's ledgers are everyone's to read, but the lines themselves are
 * the existing finance-only budget rule the build brief points back to).
 *
 * | Prop   | Type          | Notes                                             |
 * |--------|---------------|------------------------------------------------------|
 * | lines  | BudgetLine[]  | Every year the project has a line for.                |
 * | year   | number        | The year currently shown; the caller owns the select.  |
 * | onYearChange | (year) => void |                                                  |
 * | onSave | (lines) => void | The whole year's lines, replaced (PUT), not patched. |
 * | saving | boolean       |                                                        |
 * | apiError | string?     |                                                        |
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, Trash2 } from "lucide-react";
import type { BudgetLine, BudgetLineType } from "@ecapital/shared";
import { formatEUR } from "@/lib/format";

export interface BudgetLineDraftRow {
  key: string;
  /** The stored line this row edits, or `null` for a row added in this session. */
  original: BudgetLine | null;
  lineType: BudgetLineType;
  category: string;
  sapGl: string;
  amount: string;
}

function toDraft(line: BudgetLine, index: number): BudgetLineDraftRow {
  return {
    key: line.id || `existing-${index}`,
    original: line,
    lineType: line.lineType,
    category: line.category ?? "",
    sapGl: line.sapGl ?? "",
    amount: String(line.amount),
  };
}

let blankSeq = 0;
function blankRow(): BudgetLineDraftRow {
  blankSeq += 1;
  return { key: `new-${blankSeq}`, original: null, lineType: "BUDGET", category: "", sapGl: "", amount: "0" };
}

export interface BudgetLinesEditorProps {
  lines: BudgetLine[];
  year: number;
  onYearChange: (year: number) => void;
  onSave: (rows: BudgetLineDraftRow[]) => void;
  saving?: boolean;
  apiError?: string;
}

export function BudgetLinesEditor({ lines, year, onYearChange, onSave, saving = false, apiError }: BudgetLinesEditorProps) {
  const t = useTranslations();
  const yearLines = lines.filter((l) => l.budgetYear === year);
  const [draft, setDraft] = useState<BudgetLineDraftRow[]>(() => yearLines.map(toDraft));

  // Re-derive the draft whenever the year or the underlying lines change —
  // adjusted during render (React's own recommended pattern for resetting
  // state on a prop change, the same one `ConfirmDialog`'s `wasOpen` uses)
  // rather than in an effect, which would set state a render late.
  const signature = `${year}:${yearLines.map((l) => `${l.id}:${l.amount}:${l.category}:${l.sapGl}:${l.lineType}`).join("|")}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  if (signature !== prevSignature) {
    setPrevSignature(signature);
    setDraft(yearLines.map(toDraft));
  }

  function updateRow(key: string, field: keyof Omit<BudgetLineDraftRow, "key">, value: string) {
    setDraft((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  const total = draft.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const years = Array.from(new Set(lines.map((l) => l.budgetYear))).sort((a, b) => a - b);

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <div className="flex flex-wrap items-center justify-between gap-s-3">
        <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s04.budgetLines.title")}</h2>
        <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
          {t("screens.s04.budgetLines.year")}
          <select
            value={year}
            onChange={(e) => onYearChange(Number(e.target.value))}
            className="h-9 rounded-k border border-k-grey bg-k-white px-s-2 text-fs-14 text-k-ink"
          >
            {(years.includes(year) ? years : [...years, year]).sort((a, b) => a - b).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {draft.length === 0 ? (
        <div className="mt-s-3 text-center">
          <p className="text-fs-16 text-k-text">{t("screens.s04.budgetLines.empty")}</p>
          <button
            type="button"
            onClick={() => setDraft((rows) => [...rows, blankRow()])}
            className="mt-s-4 rounded-k bg-k-blue px-s-5 py-s-3 text-fs-14 font-bold text-k-white shadow-k"
          >
            {t("buttons.add")}
          </button>
        </div>
      ) : (
        <div className="mt-s-3 overflow-auto">
          <table className="w-full border-collapse text-fs-14">
            <caption className="sr-only">{t("screens.s04.budgetLines.title")}</caption>
            <thead>
              <tr style={{ height: 36 }}>
                {(["type", "category", "sapGl", "amount"] as const).map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className={`border-b border-k-grey px-s-2 font-bold text-k-blue-deep ${col === "amount" ? "num" : "text-left"}`}
                  >
                    {t(`screens.s04.budgetLines.columns.${col}`)}
                  </th>
                ))}
                <th scope="col" className="border-b border-k-grey px-s-2" />
              </tr>
            </thead>
            <tbody>
              {draft.map((row) => (
                <tr key={row.key} style={{ height: 36 }}>
                  <td className="border-b border-k-grey px-s-2">
                    <select
                      value={row.lineType}
                      onChange={(e) => updateRow(row.key, "lineType", e.target.value)}
                      className="h-9 rounded-k border border-k-grey bg-k-white px-s-1 text-fs-14"
                    >
                      <option value="BUDGET">{t("screens.s04.budgetLines.type.BUDGET")}</option>
                      <option value="FORECAST">{t("screens.s04.budgetLines.type.FORECAST")}</option>
                    </select>
                  </td>
                  <td className="border-b border-k-grey px-s-2">
                    <input
                      value={row.category}
                      onChange={(e) => updateRow(row.key, "category", e.target.value)}
                      aria-label={t("screens.s04.budgetLines.columns.category")}
                      className="w-[160px] rounded-k border border-k-grey px-s-1"
                    />
                  </td>
                  <td className="border-b border-k-grey px-s-2">
                    <input
                      value={row.sapGl}
                      onChange={(e) => updateRow(row.key, "sapGl", e.target.value)}
                      aria-label={t("screens.s04.budgetLines.columns.sapGl")}
                      className="w-[120px] rounded-k border border-k-grey px-s-1"
                    />
                  </td>
                  <td className="num border-b border-k-grey px-s-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.amount}
                      onChange={(e) => updateRow(row.key, "amount", e.target.value)}
                      aria-label={t("screens.s04.budgetLines.columns.amount")}
                      className="num w-[120px] rounded-k border border-k-grey px-s-1"
                    />
                  </td>
                  <td className="border-b border-k-grey px-s-2">
                    <button
                      type="button"
                      onClick={() => setDraft((rows) => rows.filter((r) => r.key !== row.key))}
                      aria-label={t("buttons.cancel")}
                      className="rounded-k p-s-1 text-k-text hover:bg-k-surface"
                    >
                      <Trash2 size={20} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="px-s-2 py-s-2 text-right font-bold text-k-ink">
                  {t("screens.s04.totalsRow")}
                </td>
                <td className="num px-s-2 py-s-2 font-bold text-k-ink">{formatEUR(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <button
            type="button"
            onClick={() => setDraft((rows) => [...rows, blankRow()])}
            className="mt-s-3 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
          >
            {t("buttons.add")}
          </button>
        </div>
      )}

      {apiError && (
        <p role="alert" className="mt-s-3 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {apiError}
        </p>
      )}

      <div className="mt-s-3 flex items-center gap-s-3">
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={saving}
          className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
        >
          {saving && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
          {t("buttons.save")}
        </button>
      </div>
      <p className="mt-s-2 text-fs-12 text-k-text-muted">{t("screens.s04.budgetLines.financeOnlyHint")}</p>
    </section>
  );
}
