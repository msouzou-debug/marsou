/**
 * The generic table export (UAT 25/11/2026: «Εξαγωγή σε Excel» did nothing
 * on about twenty screens). A `Table` with no `onExport` of its own sends
 * what it shows — the visible columns, the rows in the order on screen — to
 * `POST /exports/table`, and the API builds the workbook (frozen header,
 * autofilter, € and date formats, live `SUBTOTAL` totals, a sheet saying
 * which screen and when; `apps/api/src/exports/table-export.ts`).
 *
 * RULES:
 *   - a figure or a date goes as its accessor's value, never the rendered
 *     cell, so Excel gets 1234.56 and a real date, not «1.234,56 €»;
 *   - a text column goes as the cell's own text when the cell renders plain
 *     text (a status shown as «Εγκρίθηκε», not `APPROVED`), else as the
 *     accessor's value; an object becomes its name, title, label or code;
 *   - «—» and "" are blank cells, never 0 (CAPEX-01 §7);
 *   - a column of buttons (`actions`, `edit`) or one marked
 *     `exportKind: "none"` is left out;
 *   - the kind is the column's `exportKind` when it says one, else read off
 *     the values: ISO dates → date; numbers on a numeric column whose cell
 *     shows «€» (or whose id names an amount) → money; ids, numbers and
 *     codes → text; any other number → number.
 * At most `TABLE_EXPORT_MAX_ROWS` rows go: the API refuses more.
 */
import {
  TABLE_EXPORT_MAX_ROWS,
  TABLE_EXPORT_MAX_TEXT,
  type TableExportCell,
  type TableExportKind,
  type TableExportRequestInput,
} from "@ecapital/shared";
import { apiDownload } from "@/data/client";
import type { TableColumn } from "./Table";

type Translate = (key: string) => string;

const ACTION_COLUMN = /^(actions?|edit|open|select|__select)$/i;
/** Column ids that hold an amount of money even when the cell is not plain text. */
const MONEY_ID =
  /(amount|value|cost|budget|price|net|gross|vat|eur|spent|committed|forecast|approved|retention|payable|certified|invoiced|accrual|paid|balance|materials)/i;
/** Numbers that are names, not quantities: never totalled. */
const ID_LIKE = /(^|[^a-z])(number|no|code|ref|year|id|seq|tag|month)$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const DASH = "—";

function clip(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === DASH) return null;
  return trimmed.length > TABLE_EXPORT_MAX_TEXT ? `${trimmed.slice(0, TABLE_EXPORT_MAX_TEXT - 1)}…` : trimmed;
}

/** Any accessor value as something Excel can hold. */
export function plainValue(value: unknown, t: Translate): TableExportCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return clip(value);
  if (typeof value === "boolean") return t(value ? "common.yes" : "common.no");
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) {
    return clip(
      value
        .map((item) => plainValue(item, t))
        .filter((item) => item !== null)
        .join(", "),
    );
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["nameEl", "name", "titleEl", "title", "label", "code", "id"]) {
      const candidate = record[key];
      if (typeof candidate === "string" || typeof candidate === "number") return plainValue(candidate, t);
    }
    try {
      return clip(JSON.stringify(value));
    } catch {
      return null;
    }
  }
  return clip(String(value));
}

/** The cell's own text when it renders plain text; undefined when it renders markup or nothing. */
function renderedText<T>(column: TableColumn<T>, row: T): string | undefined {
  if (!column.cell) return undefined;
  try {
    const out = column.cell(row);
    if (typeof out === "string") return out;
    if (typeof out === "number") return String(out);
  } catch {
    // A cell that needs to render as a component: the accessor speaks for it.
  }
  return undefined;
}

export function exportKindOf<T>(column: TableColumn<T>, rows: T[]): TableExportKind | "none" {
  if (column.exportKind) return column.exportKind;
  if (ACTION_COLUMN.test(column.id)) return "none";
  const values = rows.map((row) => column.accessor(row)).filter((v) => v !== null && v !== undefined && v !== "");
  if (values.length > 0 && values.every((v) => v instanceof Date || (typeof v === "string" && ISO_DATE.test(v)))) {
    return "date";
  }
  const numbers = values.length > 0 && values.every((v) => typeof v === "number");
  if (!numbers) return values.length === 0 && column.numeric && MONEY_ID.test(column.id) ? "money" : "text";
  if (ID_LIKE.test(column.id)) return "text";
  if (column.numeric) {
    if (MONEY_ID.test(column.id)) return "money";
    const sample = rows.find((row) => typeof column.accessor(row) === "number");
    if (sample !== undefined && renderedText(column, sample)?.includes("€")) return "money";
  }
  return "number";
}

function cellOf<T>(column: TableColumn<T>, kind: TableExportKind, row: T, t: Translate): TableExportCell {
  const value = column.accessor(row);
  if (kind === "money" || kind === "number") {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
    return null;
  }
  if (kind === "date") return plainValue(value, t);
  const text = renderedText(column, row);
  return text !== undefined ? clip(text) : plainValue(value, t);
}

export interface TableExportInput<T> {
  /** The screen's caption: the file name and the «Οθόνη» line. */
  title: string;
  columns: TableColumn<T>[];
  rows: T[];
  t: Translate;
  /** Where it came from; defaults to the page's path. */
  source?: string;
}

/**
 * RULE (UAT 25/11/2026): a caption is a sentence for screen readers and can
 * run past the 120-character title the API takes (S02's did, and its export
 * was refused). A long one is cut at its first clause, else at a word, so the
 * export never fails on its own title.
 */
export const EXPORT_TITLE_MAX = 80;
export function exportTitleOf(caption: string): string {
  const text = caption.replace(/\s+/g, " ").trim();
  if (text.length <= EXPORT_TITLE_MAX) return text || "eCapital";
  const clause = text.split(/[,.;:]| — /)[0]?.trim() ?? "";
  if (clause.length >= 10 && clause.length <= EXPORT_TITLE_MAX) return clause;
  const cut = text.slice(0, EXPORT_TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut).trim();
}

export function tableExportRequest<T>({ title, columns, rows, t, source }: TableExportInput<T>): TableExportRequestInput {
  const shown = rows.slice(0, TABLE_EXPORT_MAX_ROWS);
  const kept = columns
    .map((column) => ({ column, kind: exportKindOf(column, shown) }))
    .filter((entry): entry is { column: TableColumn<T>; kind: TableExportKind } => entry.kind !== "none");
  // ADR-0038: a formula column names its two inputs by id; they become the
  // inputs' positions among the columns that are actually sent.
  const position = new Map(kept.map(({ column }, index) => [column.id, index]));
  const formulaOf = (column: TableColumn<T>) => {
    if (!column.exportFormula) return undefined;
    const [a, b] = column.exportFormula.columns.map((id) => position.get(id));
    if (a === undefined || b === undefined) return undefined;
    return { op: column.exportFormula.op, columns: [a, b] as [number, number] };
  };
  const shortTitle = exportTitleOf(title);
  return {
    title: shortTitle,
    sheetName: shortTitle,
    source: source ?? (typeof window === "undefined" ? undefined : window.location.pathname),
    columns: kept.map(({ column, kind }) => {
      const formula = formulaOf(column);
      return {
        header: t(column.headerKey).trim() || column.id,
        numeric: column.numeric ?? false,
        kind,
        ...(formula ? { formula } : {}),
      };
    }),
    rows: shown.map((row) => kept.map(({ column, kind }) => cellOf(column, kind, row, t))),
  };
}

/** Builds the request and downloads the workbook. Throws `ApiError` when the API refuses. */
export function exportTable<T>(input: TableExportInput<T>): Promise<void> {
  return apiDownload("/exports/table", tableExportRequest(input), "export.xlsx");
}
