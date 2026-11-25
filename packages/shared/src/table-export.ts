import { z } from "zod";

// --------------------------------------------------- generic table export
// UAT 25/11/2026: the «Εξαγωγή σε Excel» button did nothing on about twenty
// screens. Every `Table` that has no export of its own now sends what it
// shows — the visible columns, the rows in the order on screen — to
// `POST /exports/table`, and the API answers with a workbook (header frozen,
// autofilter, money and date formats, live `SUBTOTAL` totals, a note with the
// screen and the time). The screens with a purpose-built export (S04, S09a,
// S21, the reports) keep it.
//
// RULE: the values are the columns' accessors, never the rendered cell, so a
// figure reaches Excel as a number and a date as a date, not as «1.234 €».
// Headers come already translated: the API does not know the screens' keys.
//
// NO PATIENT DATA: the tables this serves carry projects, contracts, assets,
// permits and money, nothing about a patient.

/** Hard caps, so one request can never ask the API for an unbounded workbook. */
export const TABLE_EXPORT_MAX_ROWS = 20_000;
export const TABLE_EXPORT_MAX_COLUMNS = 60;
export const TABLE_EXPORT_MAX_TEXT = 2_000;

export const TableExportKind = z.enum(["text", "money", "number", "date"]);
export type TableExportKind = z.infer<typeof TableExportKind>;

export const TableExportColumn = z.object({
  header: z.string().trim().min(1).max(200),
  numeric: z.boolean().default(false),
  kind: TableExportKind.default("text"),
});
export type TableExportColumn = z.infer<typeof TableExportColumn>;

/** text → string; money and number → number; date → `YYYY-MM-DD` or an ISO date-time. Null is a blank cell. */
export const TableExportCell = z.union([
  z.string().max(TABLE_EXPORT_MAX_TEXT),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type TableExportCell = z.infer<typeof TableExportCell>;

export const TableExportRequest = z
  .object({
    /** The screen's table caption; also the file name. */
    title: z.string().trim().min(1).max(120),
    /** Excel allows 31 characters and none of `[]:*?/\`; the API cleans it, so any label will do. */
    sheetName: z.string().trim().min(1).max(120),
    /** Where it came from, e.g. `/projects`; shown in the note row. */
    source: z.string().max(300).optional(),
    columns: z.array(TableExportColumn).min(1).max(TABLE_EXPORT_MAX_COLUMNS),
    rows: z.array(z.array(TableExportCell)).max(TABLE_EXPORT_MAX_ROWS),
  })
  .refine((body) => body.rows.every((row) => row.length === body.columns.length), {
    message: "every row has one value per column",
    path: ["rows"],
  });
export type TableExportRequest = z.infer<typeof TableExportRequest>;
export type TableExportRequestInput = z.input<typeof TableExportRequest>;
