"use client";

// S07 — R08
//
/**
 * BoqSection — the contract's bill of quantities: a dense read-only table
 * with a footer total when there is a bill, an inline editor that can add
 * and remove rows when there is not (or when the caller asks to change it),
 * and one «Αποθήκευση» that `PUT`s the whole bill (`replaceBoq`, contract
 * `BoqItemWrite` — RULE: the bill is replaced whole, never patched line by
 * line, same as the API's own `contracts.service.ts`).
 *
 * | Prop      | Type          | Notes                                                    |
 * |-----------|---------------|-------------------------------------------------------------|
 * | boq       | BoqItem[]     | The contract's current bill.                                 |
 * | canEdit   | boolean       | `canWriteContracts(roles)`, mirrored from the screen.         |
 * | onSave    | (items) => Promise<void> | Fired with the whole draft; the caller PUTs and refetches. |
 * | saving    | boolean       | Disables the editor's controls while the PUT is in flight.    |
 * | apiError  | string?       | The API's own sentence for a failed save (e.g. a repeated Α/Α). |
 *
 * The editor keeps things simple, per the build brief: add/remove rows, and
 * `Enter`/`Esc` on a cell commit or discard *that* cell's edit the same way
 * `Table`'s own inline editor does — this is not `Table` itself, because
 * `Table` has no notion of adding or removing a row, but the two keyboard
 * rules are kept identical so the muscle memory carries over.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileSpreadsheet, LoaderCircle, Trash2 } from "lucide-react";
import type { BoqItem } from "@ecapital/shared";
import { formatEUR } from "@/lib/format";

export interface BoqDraftRow {
  key: string;
  itemNo: string;
  descriptionEl: string;
  unit: string;
  qty: string;
  rate: string;
}

function toDraft(item: BoqItem, index: number): BoqDraftRow {
  return {
    key: item.id || `existing-${index}`,
    itemNo: item.itemNo,
    descriptionEl: item.descriptionEl,
    unit: item.unit,
    qty: String(item.qty),
    rate: String(item.rate),
  };
}

let blankRowSeq = 0;
function blankRow(): BoqDraftRow {
  blankRowSeq += 1;
  return { key: `new-${blankRowSeq}`, itemNo: "", descriptionEl: "", unit: "", qty: "0", rate: "0" };
}

function amountOf(row: BoqDraftRow): number {
  const qty = Number(row.qty);
  const rate = Number(row.rate);
  return Number.isFinite(qty) && Number.isFinite(rate) ? qty * rate : 0;
}

export interface BoqSectionProps {
  boq: BoqItem[];
  canEdit: boolean;
  onSave: (items: BoqDraftRow[]) => void;
  saving?: boolean;
  apiError?: string;
}

export function BoqSection({ boq, canEdit, onSave, saving = false, apiError }: BoqSectionProps) {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BoqDraftRow[]>(() => boq.map(toDraft));
  // Snapshot per field, for Esc to restore exactly what Enter would have
  // committed — the same "Esc abandons, Enter commits" rule `Table`'s own
  // inline editor states in its header comment.
  const [snapshot, setSnapshot] = useState<Record<string, string>>({});

  function startEditing() {
    setDraft(boq.map(toDraft));
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setDraft(boq.map(toDraft));
  }

  function updateRow(key: string, field: keyof Omit<BoqDraftRow, "key">, value: string) {
    setDraft((rows) => rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  function fieldKey(rowKey: string, field: string) {
    return `${rowKey}.${field}`;
  }

  function onFieldFocus(row: BoqDraftRow, field: keyof Omit<BoqDraftRow, "key">) {
    setSnapshot((s) => ({ ...s, [fieldKey(row.key, field)]: row[field] }));
  }

  function onFieldKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    row: BoqDraftRow,
    field: keyof Omit<BoqDraftRow, "key">,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      const original = snapshot[fieldKey(row.key, field)] ?? "";
      updateRow(row.key, field, original);
      event.currentTarget.blur();
    }
  }

  function addRow() {
    setDraft((rows) => [...rows, blankRow()]);
  }

  function removeRow(key: string) {
    setDraft((rows) => rows.filter((row) => row.key !== key));
  }

  const total = boq.reduce((sum, item) => sum + item.amount, 0);
  const draftTotal = draft.reduce((sum, row) => sum + amountOf(row), 0);

  if (editing) {
    return (
      <section className="rounded-k border border-k-grey bg-k-white p-s-4">
        <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s07.boq.editTitle")}</h2>
        <div className="mt-s-3 overflow-auto">
          <table className="w-full border-collapse text-fs-14">
            <caption className="sr-only">{t("screens.s07.boq.caption")}</caption>
            <thead>
              <tr style={{ height: 36 }}>
                {(["itemNo", "description", "unit", "qty", "rate", "amount"] as const).map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className={`border-b border-k-grey px-s-2 font-bold text-k-blue-deep ${
                      col === "qty" || col === "rate" || col === "amount" ? "num" : "text-left"
                    }`}
                  >
                    {t(`screens.s07.boq.columns.${col}`)}
                  </th>
                ))}
                <th scope="col" className="border-b border-k-grey px-s-2" />
              </tr>
            </thead>
            <tbody>
              {draft.map((row) => (
                <tr key={row.key} style={{ height: 36 }}>
                  <td className="num border-b border-k-grey px-s-2">
                    <input
                      value={row.itemNo}
                      onFocus={() => onFieldFocus(row, "itemNo")}
                      onChange={(e) => updateRow(row.key, "itemNo", e.target.value)}
                      onKeyDown={(e) => onFieldKeyDown(e, row, "itemNo")}
                      aria-label={t("screens.s07.boq.columns.itemNo")}
                      className="num w-[72px] rounded-k border border-k-grey px-s-1"
                    />
                  </td>
                  <td className="border-b border-k-grey px-s-2">
                    <input
                      value={row.descriptionEl}
                      onFocus={() => onFieldFocus(row, "descriptionEl")}
                      onChange={(e) => updateRow(row.key, "descriptionEl", e.target.value)}
                      onKeyDown={(e) => onFieldKeyDown(e, row, "descriptionEl")}
                      aria-label={t("screens.s07.boq.columns.description")}
                      className="w-full min-w-[200px] rounded-k border border-k-grey px-s-1"
                    />
                  </td>
                  <td className="border-b border-k-grey px-s-2">
                    <input
                      value={row.unit}
                      onFocus={() => onFieldFocus(row, "unit")}
                      onChange={(e) => updateRow(row.key, "unit", e.target.value)}
                      onKeyDown={(e) => onFieldKeyDown(e, row, "unit")}
                      aria-label={t("screens.s07.boq.columns.unit")}
                      className="w-[72px] rounded-k border border-k-grey px-s-1"
                    />
                  </td>
                  <td className="num border-b border-k-grey px-s-2">
                    <input
                      type="number"
                      value={row.qty}
                      onFocus={() => onFieldFocus(row, "qty")}
                      onChange={(e) => updateRow(row.key, "qty", e.target.value)}
                      onKeyDown={(e) => onFieldKeyDown(e, row, "qty")}
                      aria-label={t("screens.s07.boq.columns.qty")}
                      className="num w-[100px] rounded-k border border-k-grey px-s-1"
                    />
                  </td>
                  <td className="num border-b border-k-grey px-s-2">
                    <input
                      type="number"
                      value={row.rate}
                      onFocus={() => onFieldFocus(row, "rate")}
                      onChange={(e) => updateRow(row.key, "rate", e.target.value)}
                      onKeyDown={(e) => onFieldKeyDown(e, row, "rate")}
                      aria-label={t("screens.s07.boq.columns.rate")}
                      className="num w-[100px] rounded-k border border-k-grey px-s-1"
                    />
                  </td>
                  <td className="num border-b border-k-grey px-s-2">{formatEUR(amountOf(row))}</td>
                  <td className="border-b border-k-grey px-s-2">
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      aria-label={t("screens.s07.boq.removeRow")}
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
                <td colSpan={5} className="px-s-2 py-s-2 text-right font-bold text-k-ink">
                  {t("screens.s07.boq.total")}
                </td>
                <td className="num px-s-2 py-s-2 font-bold text-k-ink">{formatEUR(draftTotal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-s-3 flex items-center justify-between">
          <button
            type="button"
            onClick={addRow}
            className="rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
          >
            {t("buttons.add")}
          </button>
        </div>

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
          <button
            type="button"
            onClick={cancelEditing}
            disabled={saving}
            className="h-11 rounded-k px-s-5 text-fs-14 text-k-text disabled:opacity-60"
          >
            {t("buttons.cancel")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <div className="flex items-center justify-between gap-s-3">
        <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s07.boq.title")}</h2>
        <div className="flex items-center gap-s-3">
          {/* RULE (CONVENTIONS.md): every table has an export button, top
              right, always rendered. */}
          <button
            type="button"
            onClick={() => undefined}
            className="flex items-center gap-s-2 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
          >
            <FileSpreadsheet size={20} strokeWidth={1.5} aria-hidden="true" />
            {t("buttons.exportExcel")}
          </button>
          {canEdit && boq.length > 0 && (
            <button
              type="button"
              onClick={startEditing}
              className="text-fs-14 font-bold text-k-blue-deep underline-offset-2 hover:underline"
            >
              {t("buttons.edit")}
            </button>
          )}
        </div>
      </div>

      {boq.length === 0 ? (
        <div className="mt-s-3 text-center">
          <p className="text-fs-16 text-k-text">{t("screens.s07.boq.empty")}</p>
          {canEdit && (
            <button
              type="button"
              onClick={startEditing}
              className="mt-s-4 rounded-k bg-k-blue px-s-5 py-s-3 text-fs-14 font-bold text-k-white shadow-k"
            >
              {t("buttons.add")}
            </button>
          )}
        </div>
      ) : (
        <div className="mt-s-3 overflow-auto">
          <table className="w-full border-collapse text-fs-14" data-testid="boq-table">
            <caption className="sr-only">{t("screens.s07.boq.caption")}</caption>
            <thead>
              <tr style={{ height: 36 }}>
                {(["itemNo", "description", "unit", "qty", "rate", "amount"] as const).map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className={`border-b border-k-grey px-s-2 font-bold text-k-blue-deep ${
                      col === "qty" || col === "rate" || col === "amount" ? "num" : "text-left"
                    }`}
                  >
                    {t(`screens.s07.boq.columns.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {boq.map((item, index) => (
                <tr key={item.id} style={{ height: 36, backgroundColor: index % 2 === 1 ? "color-mix(in srgb, var(--k-grey) 40%, transparent)" : undefined }}>
                  <td className="num border-b border-k-grey px-s-2">{item.itemNo}</td>
                  <td className="border-b border-k-grey px-s-2">{item.descriptionEl}</td>
                  <td className="border-b border-k-grey px-s-2">{item.unit}</td>
                  <td className="num border-b border-k-grey px-s-2">{item.qty}</td>
                  <td className="num border-b border-k-grey px-s-2">{formatEUR(item.rate)}</td>
                  <td className="num border-b border-k-grey px-s-2">{formatEUR(item.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="boq-total-row">
                <td colSpan={5} className="px-s-2 py-s-2 text-right font-bold text-k-ink">
                  {t("screens.s07.boq.total")}
                </td>
                <td className="num px-s-2 py-s-2 font-bold text-k-ink">{formatEUR(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
