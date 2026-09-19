/**
 * R14, R15 — phase one of the SAP seam: the monthly extract, as a file.
 *
 * CAPEX-01 §7: "the user drops the monthly extract files (ME2N commitments,
 * KSB1 / FBL1N actuals) into an upload screen. The importer maps columns …".
 * This is that importer, and it is the only thing in the cost module that
 * knows a file exists. Everything above it takes `RawCostRow`s.
 *
 * .xlsx is read with exceljs, for the reason ADR-0016 gives: it keeps the
 * cell's type, so «περίπου 1,2 εκ.» in an amount column is refused instead of
 * being read as zero. .csv is read here because a SAP client that cannot save
 * a workbook can always save a list, and a finance clerk with a .csv should
 * not have to open Excel to get it in.
 */
import ExcelJS from "exceljs";
import type { CostSource } from "@ecapital/shared";
import { AppError } from "../../common/errors";
import {
  type ColumnTarget,
  indexColumns,
  loadSapProfile,
  type SapProfile,
} from "./sap-profile";
import type { CostSourceReader, CostSourceRequest, RawCostRow, RawRowProblem } from "./cost-source";
import { applySign, parseAmount, parseDate } from "./values";

/** What the controller hands the reader. Nothing above it sees this shape. */
export interface SapExtractPayload {
  fileName: string;
  content: Buffer;
}

function isPayload(value: unknown): value is SapExtractPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SapExtractPayload).fileName === "string" &&
    Buffer.isBuffer((value as SapExtractPayload).content)
  );
}

/** One cell, as the reader sees it: its text, and its typed value if it has one. */
interface RawCell {
  text: string;
  number: number | null;
  date: Date | null;
}

const EMPTY: RawCell = { text: "", number: null, date: null };

export class SapExtractReader implements CostSourceReader {
  readonly source: CostSource = "SAP_EXTRACT";

  constructor(private readonly profileDir?: string) {}

  async *read(input: CostSourceRequest): AsyncIterable<RawCostRow> {
    if (!isPayload(input.payload)) throw AppError.badRequest("errors.costFileNeeded");
    const profile = this.profileDir
      ? loadSapProfile(input.report, this.profileDir)
      : loadSapProfile(input.report);

    const rows = input.payload.fileName.toLowerCase().endsWith(".csv")
      ? readCsv(input.payload.content, profile)
      : await readWorkbook(input.payload.content, profile);

    const header = (rows[profile.header_row - 1] ?? []).map((cell) => cell.text);
    const { found, missing } = indexColumns(profile, header);

    // RULE: a file missing a column the profile calls required cannot be
    // read at all. That is a 422 on the import and not three thousand
    // exceptions, because the answer is "you exported the wrong layout".
    if (missing.length) {
      throw AppError.unprocessable("errors.costColumnsMissing", { columns: missing.join(", ") });
    }

    let blankRun = 0;
    for (let index = profile.first_data_row - 1; index < rows.length; index += 1) {
      const cells = rows[index];
      if (!cells || cells.every((cell) => cell.text === "")) {
        blankRun += 1;
        if (blankRun >= profile.blank_run_to_stop) break;
        continue;
      }
      blankRun = 0;
      yield toRawRow(cells, index + 1, profile, found);
    }
  }
}

function pick(cells: RawCell[], found: Map<ColumnTarget, number>, target: ColumnTarget): RawCell {
  const at = found.get(target);
  if (at === undefined) return EMPTY;
  return cells[at] ?? EMPTY;
}

function text(cell: RawCell): string | null {
  return cell.text === "" ? null : cell.text;
}

function toRawRow(
  cells: RawCell[],
  rowNo: number,
  profile: SapProfile,
  found: Map<ColumnTarget, number>,
): RawCostRow {
  const problems: RawRowProblem[] = [];

  const amountCell = pick(cells, found, "amount");
  const amount = parseAmount(
    amountCell.number ?? text(amountCell),
    profile.number_format,
  );
  if (amount === null) {
    problems.push({
      rule: "AMOUNT_UNREADABLE",
      value: amountCell.text || null,
      messageKey: "import.cost.amountUnreadable",
      params: { row: String(rowNo), value: amountCell.text },
    });
  }

  const postingCell = pick(cells, found, "postingDate");
  const postingDate = parseDate(postingCell.date ?? text(postingCell), profile.date_format);
  if (postingDate === null) {
    problems.push({
      rule: "DATE_UNREADABLE",
      value: postingCell.text || null,
      messageKey: "import.cost.dateUnreadable",
      params: { row: String(rowNo), value: postingCell.text },
    });
  }

  const docCell = pick(cells, found, "docDate");
  const docDate = parseDate(docCell.date ?? text(docCell), profile.date_format);

  const reference = pick(cells, found, "sourceRef").text;
  const item = pick(cells, found, "lineItem").text;
  if (reference === "") {
    problems.push({
      rule: "ROW_UNREADABLE",
      value: null,
      messageKey: "import.cost.referenceMissing",
      params: { row: String(rowNo) },
    });
  }

  return {
    rowNo,
    sourceRef: item === "" ? reference : `${reference}/${item}`,
    docDate,
    postingDate,
    amount: amount === null ? null : applySign(amount, profile.sign),
    description: pick(cells, found, "description").text,
    vendorName: text(pick(cells, found, "vendorName")),
    sapWbs: text(pick(cells, found, "sapWbs")),
    sapPo: text(pick(cells, found, "sapPo")),
    costCentre: text(pick(cells, found, "costCentre")),
    glAccount: text(pick(cells, found, "glAccount")),
    problems,
  };
}

async function readWorkbook(content: Buffer, profile: SapProfile): Promise<RawCell[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(content as unknown as ArrayBuffer);
  } catch {
    throw AppError.unprocessable("errors.costFileUnreadable");
  }
  const sheet = profile.sheet
    ? workbook.getWorksheet(profile.sheet)
    : workbook.worksheets[0];
  if (!sheet) throw AppError.unprocessable("errors.costSheetMissing", { sheet: profile.sheet ?? "" });

  let width = sheet.actualColumnCount || sheet.columnCount || 0;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    width = Math.max(width, row.actualCellCount || 0, row.cellCount || 0);
  });

  const rows: RawCell[][] = [];
  for (let rowNo = 1; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const cells: RawCell[] = [];
    for (let column = 1; column <= width; column += 1) {
      cells.push(cellFrom(row.getCell(column).value));
    }
    rows.push(cells);
  }
  return rows;
}

function cellFrom(value: ExcelJS.CellValue): RawCell {
  if (value === null || value === undefined) return EMPTY;
  if (typeof value === "object" && "formula" in value) {
    return cellFrom((value as ExcelJS.CellFormulaValue).result ?? null);
  }
  if (typeof value === "object" && "richText" in value) {
    const joined = (value as ExcelJS.CellRichTextValue).richText.map((part) => part.text).join("");
    return { text: joined.trim(), number: null, date: null };
  }
  if (typeof value === "object" && "error" in value) {
    return { text: String((value as ExcelJS.CellErrorValue).error), number: null, date: null };
  }
  if (typeof value === "object" && "text" in value) {
    return { text: String((value as ExcelJS.CellHyperlinkValue).text).trim(), number: null, date: null };
  }
  if (value instanceof Date) {
    return { text: value.toISOString().slice(0, 10), number: null, date: value };
  }
  if (typeof value === "number") {
    return { text: String(value), number: value, date: null };
  }
  if (typeof value === "boolean") {
    return { text: value ? "TRUE" : "FALSE", number: null, date: null };
  }
  return { text: String(value).trim(), number: null, date: null };
}

/**
 * A small CSV reader: quoted fields, doubled quotes inside them, CRLF or LF.
 * Nothing clever — a SAP list export is a rectangle, and the delimiter comes
 * from the profile because a Greek client writes `;` and an English one `,`.
 */
export function readCsv(content: Buffer, profile: SapProfile): RawCell[][] {
  // A SAP export is usually UTF-8 with a byte-order mark. Dropping it here
  // stops the first header cell being «﻿Document Number», which matches
  // nothing.
  const text = content.toString("utf8").replace(/^﻿/, "");
  const rows: RawCell[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === profile.csv_delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row.map((value) => ({ text: value.trim(), number: null, date: null })));
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row.map((value) => ({ text: value.trim(), number: null, date: null })));
  }
  return rows;
}
