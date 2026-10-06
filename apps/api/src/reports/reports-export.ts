/**
 * M6 — the seven reports as Excel workbooks with live formulas (R39,
 * ADR-0032 §2).
 *
 * RULE (owner, the same one cost-export.ts and maintenance-export.ts live
 * by): the inputs are values and every derived figure is a formula —
 * totals, percentages, slippage, rates, ratios. The house colours say which
 * is which:
 *   blue   (FF0000FF)  an input, as the system holds it;
 *   black  (FF000000)  a formula on the same sheet;
 *   green  (FF008000)  a formula that reaches across to another sheet;
 *   amber  (FFFFBF00)  an assumption: an input cell the formulas name, with a
 *                      note saying what it is (the year elapsed, the
 *                      100.000 € defect base, the scoring period, the year).
 * A figure the system does not have is a blank cell, never 0, exactly as the
 * screen shows «—» (CAPEX-01 §7).
 *
 * Sheet 1 «Στοιχεία» carries the meta (report, unit, period, generated at),
 * the assumptions and the rows; «Σύνοψη» links to it. Headers are Greek in
 * one row and English in the next (CAPEX-01 §6.1).
 */
import ExcelJS from "exceljs";
import {
  type AssetLifecycleReport,
  type BacklogByBandReport,
  type CapitalProgrammeReport,
  type ClinicalDisruptionReport,
  type ExceptionsReport,
  RISK_BAND_ORDER,
  type ReportMeta,
  type Scorecard,
  type StatutoryComplianceReport,
} from "@ecapital/shared";
import type { I18nService } from "../common/i18n.service";
import { DEFECT_RATE_BASE } from "./report-rows";
import type { ContractorScorecardData } from "./reports.service";
import { STATUTORY_ORDER } from "./statutory";

export const COLOUR = {
  input: "FF0000FF",
  formula: "FF000000",
  link: "FF008000",
  assumption: "FFFFBF00",
} as const;

/** The sheet names the formulas reach across to. Fixed, because a formula names them. */
export const SHEET = { data: "Στοιχεία", summary: "Σύνοψη", maintenance: "Συντήρηση" } as const;

const MONEY = "#,##0.00";
const PCT = "0.0";
const INT = "0";
const HOURS = "#,##0.00";
const DATE = "dd/mm/yyyy";
const DATE_TIME = "dd/mm/yyyy hh:mm";
const HEADER_FILL = "FFEFEFEF";

type Value = string | number | Date | null;
interface Label {
  el: string;
  en: string;
}

// --------------------------------------------------------- the toolkit --

class Words {
  constructor(private readonly i18n: I18nService) {}
  of(key: string, params: Record<string, string> = {}): Label {
    return {
      el: this.i18n.translate(`reports.${key}`, "el", params),
      en: this.i18n.translate(`reports.${key}`, "en", params),
    };
  }
  el(key: string, params: Record<string, string> = {}): string {
    return this.i18n.translate(`reports.${key}`, "el", params);
  }
  column(key: string): Label {
    return this.of(`columns.${key}`);
  }
  global(key: string): string {
    return this.i18n.translate(key, "el", {});
  }
}

export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function quoted(sheet: string): string {
  return `'${sheet.replace(/'/g, "''")}'`;
}

/** `'Στοιχεία'!$C$12` — a reference across sheets. */
function across(sheet: string, address: string): string {
  return `${quoted(sheet)}!${address}`;
}

type Colour = "formula" | "link";

interface Col<R> {
  key: string;
  header?: Label;
  width?: number;
  fmt?: string;
  /** An input as the system holds it (blue); null leaves the cell blank. */
  input?: (row: R) => Value;
  /** A label, not a figure: plain black text. */
  text?: (row: R) => Value;
  /** A derived figure; `c(key)` is the address of that column in the same row. */
  formula?: (c: (key: string) => string, row: R | null) => string;
  colour?: Colour | ((row: R | null) => Colour);
  /**
   * The totals row: `sum`; `known` sums what is there and is blank when
   * nothing is; `complete` is blank as soon as one row is; `same` writes the
   * column's own formula over the totals row; nothing leaves it empty.
   */
  total?: "sum" | "known" | "complete" | "same";
}

interface Table {
  first: number;
  last: number;
  totals: number | null;
  /** The column letter of a key. */
  letter: (key: string) => string;
  /** The data range of a column, e.g. `C7:C18`, or null when there are no rows. */
  range: (key: string) => string | null;
}

function styleHeader(row: ExcelJS.Row, bold: boolean): void {
  row.font = { bold, size: 11 };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function paint(cell: ExcelJS.Cell, argb: string, bold = false): void {
  cell.font = { color: { argb }, bold };
}

function writeTable<R>(
  sheet: ExcelJS.Worksheet,
  start: number,
  cols: Col<R>[],
  rows: R[],
  words: Words,
  options: { totals: boolean },
): Table {
  const letters = new Map(cols.map((col, i) => [col.key, columnLetter(i + 1)]));
  const letter = (key: string) => {
    const found = letters.get(key);
    if (!found) throw new Error(`no column ${key}`);
    return found;
  };

  const el = sheet.getRow(start);
  const en = sheet.getRow(start + 1);
  cols.forEach((col, i) => {
    const header = col.header ?? words.column(col.key);
    el.getCell(i + 1).value = header.el;
    en.getCell(i + 1).value = header.en;
    sheet.getColumn(i + 1).width = Math.max(sheet.getColumn(i + 1).width ?? 0, col.width ?? 16);
  });
  styleHeader(el, true);
  styleHeader(en, false);

  const first = start + 2;
  const last = first + rows.length - 1;
  const range = (key: string) => (rows.length ? `${letter(key)}${first}:${letter(key)}${last}` : null);

  const writeCells = (rowNo: number, row: R | null) => {
    const at = (key: string) => `${letter(key)}${rowNo}`;
    cols.forEach((col, i) => {
      const cell = sheet.getRow(rowNo).getCell(i + 1);
      if (col.fmt) cell.numFmt = col.fmt;
      if (row !== null && col.input) {
        const value = col.input(row);
        if (value !== null) cell.value = value;
        paint(cell, COLOUR.input);
      } else if (row !== null && col.text) {
        const value = col.text(row);
        if (value !== null) cell.value = value;
      } else if (col.formula && (row !== null || col.total === "same")) {
        cell.value = { formula: col.formula(at, row) } as ExcelJS.CellFormulaValue;
        const colour = typeof col.colour === "function" ? col.colour(row) : (col.colour ?? "formula");
        paint(cell, colour === "link" ? COLOUR.link : COLOUR.formula, row === null);
      }
    });
  };

  rows.forEach((row, index) => writeCells(first + index, row));

  let totals: number | null = null;
  if (options.totals) {
    totals = first + rows.length;
    const totalRow = sheet.getRow(totals);
    writeCells(totals, null);
    totalRow.getCell(1).value = words.el("total");
    totalRow.getCell(1).font = { bold: true };
    cols.forEach((col, i) => {
      const cell = totalRow.getCell(i + 1);
      const r = range(col.key);
      let formula: string | null = null;
      if (col.total === "sum") formula = r ? `SUM(${r})` : "0";
      else if (col.total === "known") formula = r ? `IF(COUNT(${r})=0,"",SUM(${r}))` : `""`;
      else if (col.total === "complete") {
        formula = r ? `IF(COUNTBLANK(${r})>0,"",SUM(${r}))` : `""`;
      }
      if (formula !== null) {
        cell.value = { formula } as ExcelJS.CellFormulaValue;
        if (col.fmt) cell.numFmt = col.fmt;
        paint(cell, COLOUR.formula, true);
      }
    });
  }

  sheet.views = [{ state: "frozen", ySplit: start + 1 }];
  return { first, last, totals, letter, range };
}

interface Assumption {
  id: string;
  key: string;
  value: number | Date;
  fmt: string;
}

/**
 * Rows 1–4 the meta, then one amber row per assumption. Returns the next
 * free row and the absolute address of each assumption.
 */
function writeMeta(
  sheet: ExcelJS.Worksheet,
  words: Words,
  meta: ReportMeta,
  assumptions: Assumption[],
): { next: number; at: Record<string, string> } {
  const both = (label: Label) => `${label.el} / ${label.en}`;
  const period =
    meta.from && meta.to
      ? words.el("meta.periodValue", { from: meta.from, to: meta.to })
      : meta.year !== null
        ? String(meta.year)
        : words.el("meta.noPeriod");
  const lines: [Label, Value][] = [
    [words.of("meta.report"), words.el(`title.${meta.key}`)],
    [words.of("meta.unit"), meta.orgUnitName ?? words.el("meta.allUnits")],
    [words.of("meta.period"), period],
    [words.of("meta.generatedAt"), new Date(meta.generatedAt)],
  ];
  lines.forEach(([label, value], i) => {
    const row = sheet.getRow(i + 1);
    row.getCell(1).value = both(label);
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = value;
    if (value instanceof Date) row.getCell(2).numFmt = DATE_TIME;
    if (i === 0) row.getCell(2).font = { bold: true, size: 13 };
  });

  const at: Record<string, string> = {};
  assumptions.forEach((assumption, i) => {
    const rowNo = lines.length + 1 + i;
    const row = sheet.getRow(rowNo);
    row.getCell(1).value = both(words.of(`assumption.${assumption.key}`));
    row.getCell(1).font = { bold: true };
    const cell = row.getCell(2);
    cell.value = assumption.value;
    cell.numFmt = assumption.fmt;
    // An assumption is an input the formulas name: blue type on amber.
    cell.font = { color: { argb: COLOUR.input }, bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOUR.assumption } };
    const note = words.of(`assumption.${assumption.key}Note`);
    cell.note = `${note.el}\n\n${note.en}`;
    at[assumption.id] = `$B$${rowNo}`;
  });
  sheet.getColumn(1).width = Math.max(sheet.getColumn(1).width ?? 0, 34);
  sheet.getColumn(2).width = Math.max(sheet.getColumn(2).width ?? 0, 30);
  return { next: lines.length + assumptions.length + 2, at };
}

function newBook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eCapital";
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  return workbook;
}

async function done(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** One line of a «Σύνοψη»: a label and a formula, green when it reaches across. */
interface SummaryLine {
  label: Label;
  formula: string;
  link: boolean;
  fmt: string;
}

function summarySheet(workbook: ExcelJS.Workbook, words: Words, lines: SummaryLine[]): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(SHEET.summary);
  writeTable<SummaryLine>(
    sheet,
    1,
    [
      { key: "item", header: words.of("summary.item"), width: 46, text: (l) => l.label.el },
      { key: "itemEn", header: { el: "", en: "" }, width: 40, text: (l) => l.label.en },
      {
        key: "value",
        header: words.of("summary.value"),
        width: 22,
        formula: (_c, l) => (l ? l.formula : ""),
        colour: (l) => (l?.link ? "link" : "formula"),
      },
    ],
    lines,
    words,
    { totals: false },
  );
  lines.forEach((line, i) => {
    sheet.getRow(3 + i).getCell(3).numFmt = line.fmt;
  });
  return sheet;
}

/** The address of a summary line's value, for a formula on the same sheet. */
function summaryCell(index: number): string {
  return `C${3 + index}`;
}

const data = (address: string) => across(SHEET.data, address);

// ------------------------------------------------ 1. capital programme --

type CapitalRow = CapitalProgrammeReport["rows"][number];

export async function capitalProgrammeWorkbook(
  report: CapitalProgrammeReport,
  i18n: I18nService,
): Promise<Buffer> {
  const words = new Words(i18n);
  const workbook = newBook();
  const sheet = workbook.addWorksheet(SHEET.data);
  const { next, at } = writeMeta(sheet, words, report.meta, [
    { id: "year", key: "yearElapsed", value: report.yearElapsedPct, fmt: PCT },
  ]);
  const cols: Col<CapitalRow>[] = [
    { key: "unit", width: 40, input: (r) => r.orgUnit.nameEl },
    { key: "projects", width: 10, fmt: INT, input: (r) => r.projectCount, total: "sum" },
    { key: "approved", width: 20, fmt: MONEY, input: (r) => r.approved, total: "sum" },
    { key: "committed", width: 18, fmt: MONEY, input: (r) => r.committed, total: "known" },
    { key: "spent", width: 18, fmt: MONEY, input: (r) => r.spent, total: "known" },
    { key: "forecast", width: 20, fmt: MONEY, input: (r) => r.forecast, total: "complete" },
    {
      key: "slippage",
      width: 18,
      fmt: MONEY,
      formula: (c) => `IF(${c("forecast")}="","",${c("forecast")}-${c("approved")})`,
      total: "same",
    },
    {
      key: "spentPct",
      width: 14,
      fmt: PCT,
      formula: (c) => `IF(OR(${c("spent")}="",${c("approved")}=0),"",${c("spent")}/${c("approved")}*100)`,
      total: "same",
    },
    {
      key: "gapToYear",
      width: 18,
      fmt: PCT,
      formula: (c) => `IF(${c("spentPct")}="","",${c("spentPct")}-${at.year})`,
      total: "same",
    },
    { key: "green", width: 10, fmt: INT, input: (r) => r.rag.green, total: "sum" },
    { key: "amber", width: 10, fmt: INT, input: (r) => r.rag.amber, total: "sum" },
    { key: "red", width: 10, fmt: INT, input: (r) => r.rag.red, total: "sum" },
  ];
  const table = writeTable(sheet, next, cols, report.rows, words, { totals: true });
  const total = (key: string) => data(`${table.letter(key)}${table.totals}`);

  const lines: SummaryLine[] = [
    { label: words.column("approved"), formula: total("approved"), link: true, fmt: MONEY },
    { label: words.column("committed"), formula: total("committed"), link: true, fmt: MONEY },
    { label: words.column("spent"), formula: total("spent"), link: true, fmt: MONEY },
    { label: words.column("forecast"), formula: total("forecast"), link: true, fmt: MONEY },
    { label: words.column("slippage"), formula: total("slippage"), link: true, fmt: MONEY },
    { label: words.column("spentPct"), formula: total("spentPct"), link: true, fmt: PCT },
    { label: words.of("assumption.yearElapsed"), formula: data(at.year), link: true, fmt: PCT },
  ];
  lines.push({
    label: words.of("summary.committedPct"),
    formula: `IF(OR(${summaryCell(1)}="",${summaryCell(0)}=0),"",${summaryCell(1)}/${summaryCell(0)}*100)`,
    link: false,
    fmt: PCT,
  });
  lines.push(
    { label: words.column("projects"), formula: total("projects"), link: true, fmt: INT },
    { label: words.column("green"), formula: total("green"), link: true, fmt: INT },
    { label: words.column("amber"), formula: total("amber"), link: true, fmt: INT },
    { label: words.column("red"), formula: total("red"), link: true, fmt: INT },
  );
  summarySheet(workbook, words, lines);
  return done(workbook);
}

// -------------------------------------------------------- 2. exceptions --

type ExceptionLine = ExceptionsReport["rows"][number];

export async function exceptionsWorkbook(report: ExceptionsReport, i18n: I18nService): Promise<Buffer> {
  const words = new Words(i18n);
  const workbook = newBook();
  const sheet = workbook.addWorksheet(SHEET.data);
  const { next } = writeMeta(sheet, words, report.meta, []);
  const cols: Col<ExceptionLine>[] = [
    { key: "projectCode", width: 16, input: (r) => r.projectCode },
    { key: "title", width: 48, input: (r) => r.titleEl },
    { key: "unit", width: 32, input: (r) => r.orgUnitName },
    { key: "phase", width: 18, input: (r) => words.el(`phase.${r.phase}`) },
    { key: "rag", width: 12, input: (r) => words.el(`rag.${r.rag}`) },
    { key: "ragReason", width: 40, input: (r) => r.ragReason || null },
    { key: "owner", width: 26, input: (r) => r.ownerName },
    { key: "approved", width: 18, fmt: MONEY, input: (r) => r.approved, total: "sum" },
    { key: "forecast", width: 18, fmt: MONEY, input: (r) => r.forecast, total: "known" },
    {
      key: "slippage",
      width: 18,
      fmt: MONEY,
      formula: (c) => `IF(${c("forecast")}="","",${c("forecast")}-${c("approved")})`,
      total: "known",
    },
    { key: "milestoneLateDays", width: 14, fmt: INT, input: (r) => r.milestoneLateDays },
    { key: "openRisksHigh", width: 14, fmt: INT, input: (r) => r.openRisksHigh, total: "sum" },
  ];
  const table = writeTable(sheet, next, cols, report.rows, words, { totals: true });
  const total = (key: string) => data(`${table.letter(key)}${table.totals}`);
  const countIf = (key: string, value: string) => {
    const r = table.range(key);
    return r ? `COUNTIF(${data(r)},"${value}")` : "0";
  };
  const lateRange = table.range("milestoneLateDays");
  summarySheet(workbook, words, [
    { label: words.of("summary.redProjects"), formula: countIf("rag", words.el("rag.RED")), link: true, fmt: INT },
    {
      label: words.of("summary.amberProjects"),
      formula: countIf("rag", words.el("rag.AMBER")),
      link: true,
      fmt: INT,
    },
    { label: words.column("approved"), formula: total("approved"), link: true, fmt: MONEY },
    { label: words.column("slippage"), formula: total("slippage"), link: true, fmt: MONEY },
    {
      label: words.of("summary.lateMilestones"),
      formula: lateRange ? `COUNT(${data(lateRange)})` : "0",
      link: true,
      fmt: INT,
    },
    { label: words.column("openRisksHigh"), formula: total("openRisksHigh"), link: true, fmt: INT },
  ]);
  return done(workbook);
}

// --------------------------------------------- 3. contractor scorecard --

type CapitalLine = ContractorScorecardData["capital"][number];

export async function contractorScorecardWorkbook(
  input: ContractorScorecardData,
  i18n: I18nService,
): Promise<Buffer> {
  const { report } = input;
  const words = new Words(i18n);
  const workbook = newBook();
  const sheet = workbook.addWorksheet(SHEET.data);
  const { next, at } = writeMeta(sheet, words, report.meta, [
    { id: "from", key: "from", value: new Date(`${report.meta.from}T00:00:00Z`), fmt: DATE },
    { id: "to", key: "to", value: new Date(`${report.meta.to}T00:00:00Z`), fmt: DATE },
    { id: "base", key: "defectBase", value: DEFECT_RATE_BASE, fmt: MONEY },
  ]);
  const pct = (num: string, den: string) => (c: (key: string) => string) =>
    `IF(${c(den)}=0,"",${c(num)}/${c(den)}*100)`;
  const cols: Col<CapitalLine>[] = [
    { key: "contractor", width: 36, input: (l) => l.facts.contractorName },
    { key: "contracts", width: 11, fmt: INT, input: (l) => l.facts.contracts, total: "sum" },
    { key: "datedContracts", width: 14, fmt: INT, input: (l) => l.facts.datedContracts, total: "sum" },
    { key: "overdueContracts", width: 13, fmt: INT, input: (l) => l.facts.overdueContracts, total: "sum" },
    {
      key: "onTimePct",
      width: 13,
      fmt: PCT,
      formula: (c) =>
        `IF(${c("datedContracts")}=0,"",(${c("datedContracts")}-${c("overdueContracts")})/${c("datedContracts")}*100)`,
      total: "same",
    },
    { key: "originalValue", width: 18, fmt: MONEY, input: (l) => l.facts.originalValue, total: "sum" },
    { key: "approvedVariations", width: 18, fmt: MONEY, input: (l) => l.facts.approvedVariations, total: "sum" },
    { key: "variationRatePct", width: 14, fmt: PCT, formula: pct("approvedVariations", "originalValue"), total: "same" },
    { key: "contractValue", width: 18, fmt: MONEY, input: (l) => l.facts.contractValue, total: "sum" },
    { key: "defects", width: 11, fmt: INT, input: (l) => l.facts.defects, total: "sum" },
    { key: "openDefects", width: 11, fmt: INT, input: (l) => l.facts.openDefects, total: "sum" },
    {
      key: "defectRate",
      width: 13,
      fmt: "0.00",
      formula: (c) => `IF(${c("contractValue")}=0,"",${c("defects")}/${c("contractValue")}*${at.base})`,
      total: "same",
    },
    { key: "rfis", width: 11, fmt: INT, input: (l) => l.facts.rfis, total: "sum" },
    { key: "rfisLate", width: 12, fmt: INT, input: (l) => l.facts.rfisLate, total: "sum" },
    { key: "rfiBreachPct", width: 13, fmt: PCT, formula: pct("rfisLate", "rfis"), total: "same" },
    { key: "certificates", width: 12, fmt: INT, input: (l) => l.facts.certificates, total: "sum" },
    { key: "certifiedClaimed", width: 18, fmt: MONEY, input: (l) => l.facts.certifiedClaimed, total: "sum" },
    { key: "certifiedApproved", width: 18, fmt: MONEY, input: (l) => l.facts.certifiedApproved, total: "sum" },
    {
      key: "claimAccuracyPct",
      width: 14,
      fmt: PCT,
      formula: (c) =>
        `IF(OR(${c("certificates")}=0,${c("certifiedClaimed")}<=0),"",MIN(100,MAX(0,${c("certifiedApproved")}/${c("certifiedClaimed")}*100)))`,
      total: "same",
    },
  ];
  const capital = writeTable(sheet, next, cols, input.capital, words, { totals: true });

  // «Συντήρηση»: one row per agreement, the scorecard's counts as inputs and
  // its ratios and the penalty total as formulas.
  const maintenance = workbook.addWorksheet(SHEET.maintenance);
  const preamble: [Label, string, string][] = [
    [words.of("assumption.from"), data(at.from), DATE],
    [words.of("assumption.to"), data(at.to), DATE],
  ];
  preamble.forEach(([label, formula, fmt], i) => {
    const row = maintenance.getRow(i + 1);
    row.getCell(1).value = `${label.el} / ${label.en}`;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = { formula } as ExcelJS.CellFormulaValue;
    row.getCell(2).numFmt = fmt;
    paint(row.getCell(2), COLOUR.link);
  });
  const days = maintenance.getRow(3);
  const daysLabel = words.of("summary.periodDays");
  days.getCell(1).value = `${daysLabel.el} / ${daysLabel.en}`;
  days.getCell(1).font = { bold: true };
  days.getCell(2).value = { formula: "B2-B1" } as ExcelJS.CellFormulaValue;
  days.getCell(2).numFmt = INT;
  paint(days.getCell(2), COLOUR.formula);

  const ratio = (num: string, den: string): Col<Scorecard>["formula"] => (c) =>
    `IF(${c(den)}=0,"",${c(num)}/${c(den)}*100)`;
  const mCols: Col<Scorecard>[] = [
    { key: "contractor", width: 36, input: (s) => s.contractorName },
    { key: "agreement", width: 16, input: (s) => s.contractRef },
    { key: "orders", width: 11, fmt: INT, input: (s) => s.workOrders.total, total: "sum" },
    { key: "corrective", width: 11, fmt: INT, input: (s) => s.workOrders.corrective, total: "sum" },
    { key: "open", width: 11, fmt: INT, input: (s) => s.workOrders.open, total: "sum" },
    { key: "responseDue", width: 12, fmt: INT, input: (s) => s.response.due, total: "sum" },
    { key: "responseOnTime", width: 12, fmt: INT, input: (s) => s.response.onTime, total: "sum" },
    { key: "responsePct", width: 12, fmt: PCT, formula: ratio("responseOnTime", "responseDue"), total: "same" },
    { key: "restoreDue", width: 12, fmt: INT, input: (s) => s.restore.due, total: "sum" },
    { key: "restoreOnTime", width: 12, fmt: INT, input: (s) => s.restore.onTime, total: "sum" },
    { key: "restorePct", width: 12, fmt: PCT, formula: ratio("restoreOnTime", "restoreDue"), total: "same" },
    { key: "reportDue", width: 12, fmt: INT, input: (s) => s.report.due, total: "sum" },
    { key: "reportOnTime", width: 12, fmt: INT, input: (s) => s.report.onTime, total: "sum" },
    { key: "reportPct", width: 12, fmt: PCT, formula: ratio("reportOnTime", "reportDue"), total: "same" },
    { key: "pmDue", width: 12, fmt: INT, input: (s) => s.pm.due, total: "sum" },
    { key: "pmOnTime", width: 12, fmt: INT, input: (s) => s.pm.onTime, total: "sum" },
    { key: "pmPct", width: 12, fmt: PCT, formula: ratio("pmOnTime", "pmDue"), total: "same" },
    { key: "penaltyPm", width: 14, fmt: MONEY, input: (s) => s.penalties.pmEur, total: "sum" },
    { key: "penaltyResponse", width: 14, fmt: MONEY, input: (s) => s.penalties.responseEur, total: "sum" },
    { key: "penaltyRestore", width: 14, fmt: MONEY, input: (s) => s.penalties.restoreEur, total: "sum" },
    { key: "penaltyAvailability", width: 14, fmt: MONEY, input: (s) => s.penalties.availabilityEur, total: "sum" },
    {
      key: "penaltyTotal",
      width: 14,
      fmt: MONEY,
      formula: (c) => `SUM(${c("penaltyPm")}:${c("penaltyAvailability")})`,
      total: "same",
    },
    {
      key: "ratesMissing",
      width: 12,
      input: (s) => words.el(s.penalties.ratesMissing ? "yes" : "no"),
    },
    { key: "repeatFailures", width: 12, fmt: INT, input: (s) => s.repeatFailures, total: "sum" },
  ];
  const agreements = writeTable(maintenance, 5, mCols, report.maintenance, words, { totals: true });

  const capitalTotal = (key: string) => data(`${capital.letter(key)}${capital.totals}`);
  const maintenanceTotal = (key: string) =>
    across(SHEET.maintenance, `${agreements.letter(key)}${agreements.totals}`);
  summarySheet(workbook, words, [
    {
      label: words.of("summary.capital"),
      formula: capital.range("contractor") ? `COUNTA(${data(capital.range("contractor") as string)})` : "0",
      link: true,
      fmt: INT,
    },
    { label: words.column("contracts"), formula: capitalTotal("contracts"), link: true, fmt: INT },
    { label: words.column("overdueContracts"), formula: capitalTotal("overdueContracts"), link: true, fmt: INT },
    { label: words.column("onTimePct"), formula: capitalTotal("onTimePct"), link: true, fmt: PCT },
    { label: words.column("variationRatePct"), formula: capitalTotal("variationRatePct"), link: true, fmt: PCT },
    { label: words.column("defectRate"), formula: capitalTotal("defectRate"), link: true, fmt: "0.00" },
    { label: words.column("rfiBreachPct"), formula: capitalTotal("rfiBreachPct"), link: true, fmt: PCT },
    { label: words.column("claimAccuracyPct"), formula: capitalTotal("claimAccuracyPct"), link: true, fmt: PCT },
    {
      label: words.of("summary.maintenance"),
      formula: agreements.range("agreement")
        ? `COUNTA(${across(SHEET.maintenance, agreements.range("agreement") as string)})`
        : "0",
      link: true,
      fmt: INT,
    },
    { label: words.column("responsePct"), formula: maintenanceTotal("responsePct"), link: true, fmt: PCT },
    { label: words.column("restorePct"), formula: maintenanceTotal("restorePct"), link: true, fmt: PCT },
    { label: words.column("pmPct"), formula: maintenanceTotal("pmPct"), link: true, fmt: PCT },
    { label: words.column("penaltyTotal"), formula: maintenanceTotal("penaltyTotal"), link: true, fmt: MONEY },
  ]);
  return done(workbook);
}

// ------------------------------------------------- 4. backlog by band --

type BacklogRow = BacklogByBandReport["rows"][number];

export async function backlogByBandWorkbook(report: BacklogByBandReport, i18n: I18nService): Promise<Buffer> {
  const words = new Words(i18n);
  const workbook = newBook();
  const sheet = workbook.addWorksheet(SHEET.data);
  const { next } = writeMeta(sheet, words, report.meta, []);

  const bandLabel = (band: string, part: string): Label => {
    const name = {
      el: i18n.translate(`maintenance.riskBand.${band}`, "el", {}),
      en: i18n.translate(`maintenance.riskBand.${band}`, "en", {}),
    };
    const what = words.column(part);
    return { el: `${name.el} — ${what.el}`, en: `${name.en} — ${what.en}` };
  };
  const cols: Col<BacklogRow>[] = [{ key: "unit", width: 40, input: (r) => r.orgUnitName }];
  RISK_BAND_ORDER.forEach((band, i) => {
    cols.push(
      { key: `${band}.count`, header: bandLabel(band, "count"), width: 12, fmt: INT, input: (r) => r.bands[i].count, total: "sum" },
      { key: `${band}.cost`, header: bandLabel(band, "cost"), width: 16, fmt: MONEY, input: (r) => r.bands[i].costEstimate, total: "sum" },
      { key: `${band}.funded`, header: bandLabel(band, "fundedCost"), width: 16, fmt: MONEY, input: (r) => r.bands[i].fundedCost, total: "sum" },
      {
        key: `${band}.unfunded`,
        header: bandLabel(band, "unfundedCost"),
        width: 16,
        fmt: MONEY,
        formula: (c) => `${c(`${band}.cost`)}-${c(`${band}.funded`)}`,
        total: "same",
      },
    );
  });
  const across4 = (part: string) => (c: (key: string) => string) =>
    RISK_BAND_ORDER.map((band) => c(`${band}.${part}`)).join("+");
  cols.push(
    { key: "itemsTotal", width: 14, fmt: INT, formula: across4("count"), total: "same" },
    { key: "costTotal", width: 18, fmt: MONEY, formula: across4("cost"), total: "same" },
    { key: "fundedTotal", width: 18, fmt: MONEY, formula: across4("funded"), total: "same" },
    {
      key: "unfundedTotal",
      width: 18,
      fmt: MONEY,
      formula: (c) => `${c("costTotal")}-${c("fundedTotal")}`,
      total: "same",
    },
  );
  const table = writeTable(sheet, next, cols, report.rows, words, { totals: true });

  // «Σύνοψη»: the four bands down the side, linked to the totals row.
  const summary = workbook.addWorksheet(SHEET.summary);
  const totalOf = (key: string) => data(`${table.letter(key)}${table.totals}`);
  interface BandLine {
    band: string;
  }
  const bandRows: BandLine[] = RISK_BAND_ORDER.map((band) => ({ band }));
  writeTable<BandLine>(
    summary,
    1,
    [
      { key: "band", header: words.of("summary.band"), width: 22, text: (b) => i18n.translate(`maintenance.riskBand.${b.band}`, "el", {}) },
      { key: "count", header: words.column("itemsTotal"), width: 14, fmt: INT, formula: (_c, b) => totalOf(`${b?.band}.count`), colour: "link", total: "sum" },
      { key: "cost", header: words.column("costTotal"), width: 18, fmt: MONEY, formula: (_c, b) => totalOf(`${b?.band}.cost`), colour: "link", total: "sum" },
      { key: "funded", header: words.column("fundedTotal"), width: 18, fmt: MONEY, formula: (_c, b) => totalOf(`${b?.band}.funded`), colour: "link", total: "sum" },
      {
        key: "unfunded",
        header: words.column("unfundedTotal"),
        width: 18,
        fmt: MONEY,
        formula: (c) => `${c("cost")}-${c("funded")}`,
        total: "same",
      },
    ],
    bandRows,
    words,
    { totals: true },
  );
  return done(workbook);
}

// -------------------------------------------------- 5. asset lifecycle --

type LifecycleRow = AssetLifecycleReport["rows"][number];

export async function assetLifecycleWorkbook(report: AssetLifecycleReport, i18n: I18nService): Promise<Buffer> {
  const words = new Words(i18n);
  const workbook = newBook();
  const sheet = workbook.addWorksheet(SHEET.data);
  const { next, at } = writeMeta(sheet, words, report.meta, [
    { id: "year", key: "reportYear", value: report.meta.year ?? new Date().getUTCFullYear(), fmt: INT },
  ]);
  const cols: Col<LifecycleRow>[] = [
    { key: "tag", width: 18, input: (r) => r.tag },
    { key: "assetName", width: 40, input: (r) => r.nameEl },
    { key: "unit", width: 30, input: (r) => r.orgUnitName },
    { key: "assetClass", width: 22, input: (r) => words.global(`assetClass.${r.assetClass}`) },
    { key: "criticality", width: 11, fmt: INT, input: (r) => r.criticality },
    { key: "condition", width: 11, input: (r) => r.condition },
    { key: "installedYear", width: 12, fmt: INT, input: (r) => r.installedYear },
    { key: "expectedLife", width: 12, fmt: INT, input: (r) => r.expectedLifeYears },
    {
      key: "remainingLife",
      width: 12,
      fmt: INT,
      formula: (c) =>
        `IF(OR(${c("installedYear")}="",${c("expectedLife")}=""),"",${c("installedYear")}+${c("expectedLife")}-${at.year})`,
    },
    { key: "replacementYear", width: 12, fmt: INT, input: (r) => r.replacementYear },
    { key: "capitalCost", width: 16, fmt: MONEY, input: (r) => r.capitalCost, total: "known" },
    { key: "maintenanceCost", width: 16, fmt: MONEY, input: (r) => r.maintenanceCost, total: "sum" },
    {
      key: "maintenanceToCapital",
      width: 14,
      fmt: PCT,
      formula: (c) =>
        `IF(OR(${c("capitalCost")}="",${c("capitalCost")}=0),"",${c("maintenanceCost")}/${c("capitalCost")}*100)`,
      total: "same",
    },
    { key: "correctiveOrders", width: 12, fmt: INT, input: (r) => r.correctiveOrders, total: "sum" },
    { key: "downtimeHours", width: 12, fmt: HOURS, input: (r) => r.downtimeHours, total: "sum" },
    { key: "replacementCost", width: 16, fmt: MONEY, input: (r) => r.replacementCostEst, total: "known" },
  ];
  const table = writeTable(sheet, next, cols, report.rows, words, { totals: true });
  const total = (key: string) => data(`${table.letter(key)}${table.totals}`);
  const tags = table.range("tag");
  const remaining = table.range("remainingLife");
  const lines: SummaryLine[] = [
    { label: words.of("summary.assets"), formula: tags ? `COUNTA(${data(tags)})` : "0", link: true, fmt: INT },
    {
      label: words.of("summary.pastLife"),
      formula: remaining ? `COUNTIF(${data(remaining)},"<=0")` : "0",
      link: true,
      fmt: INT,
    },
    { label: words.column("capitalCost"), formula: total("capitalCost"), link: true, fmt: MONEY },
    { label: words.column("maintenanceCost"), formula: total("maintenanceCost"), link: true, fmt: MONEY },
  ];
  lines.push(
    {
      label: words.column("maintenanceToCapital"),
      formula: `IF(OR(${summaryCell(2)}="",${summaryCell(2)}=0),"",${summaryCell(3)}/${summaryCell(2)}*100)`,
      link: false,
      fmt: PCT,
    },
    { label: words.column("correctiveOrders"), formula: total("correctiveOrders"), link: true, fmt: INT },
    { label: words.column("downtimeHours"), formula: total("downtimeHours"), link: true, fmt: HOURS },
    { label: words.column("replacementCost"), formula: total("replacementCost"), link: true, fmt: MONEY },
  );
  summarySheet(workbook, words, lines);
  return done(workbook);
}

// --------------------------------------------- 6. clinical disruption --

interface DisruptionLine {
  unit: string;
  month: string;
  theatreHours: number;
  icuHours: number;
  permits: number;
}

export async function clinicalDisruptionWorkbook(
  report: ClinicalDisruptionReport,
  i18n: I18nService,
): Promise<Buffer> {
  const words = new Words(i18n);
  const workbook = newBook();
  const sheet = workbook.addWorksheet(SHEET.data);
  const { next } = writeMeta(sheet, words, report.meta, []);
  const lines: DisruptionLine[] = report.rows.flatMap((row) =>
    row.months.map((m) => ({ unit: row.orgUnitName, ...m })),
  );
  const table = writeTable<DisruptionLine>(
    sheet,
    next,
    [
      { key: "unit", width: 40, input: (l) => l.unit },
      { key: "month", width: 10, input: (l) => l.month },
      { key: "theatreHours", width: 14, fmt: HOURS, input: (l) => l.theatreHours, total: "sum" },
      { key: "icuHours", width: 14, fmt: HOURS, input: (l) => l.icuHours, total: "sum" },
      { key: "permits", width: 12, fmt: INT, input: (l) => l.permits, total: "sum" },
      {
        key: "totalHours",
        width: 14,
        fmt: HOURS,
        formula: (c) => `${c("theatreHours")}+${c("icuHours")}`,
        total: "same",
      },
    ],
    lines,
    words,
    { totals: true },
  );

  const summary = workbook.addWorksheet(SHEET.summary);
  const sumIf = (key: string, unitCell: string) => {
    const values = table.range(key);
    const units = table.range("unit");
    return values && units ? `SUMIFS(${data(values)},${data(units)},${unitCell})` : "0";
  };
  writeTable<ClinicalDisruptionReport["rows"][number]>(
    summary,
    1,
    [
      { key: "unit", width: 40, input: (r) => r.orgUnitName },
      { key: "theatreHours", width: 14, fmt: HOURS, formula: (c) => sumIf("theatreHours", c("unit")), colour: "link", total: "sum" },
      { key: "icuHours", width: 14, fmt: HOURS, formula: (c) => sumIf("icuHours", c("unit")), colour: "link", total: "sum" },
      { key: "permits", width: 12, fmt: INT, formula: (c) => sumIf("permits", c("unit")), colour: "link", total: "sum" },
      {
        key: "totalHours",
        width: 14,
        fmt: HOURS,
        formula: (c) => `${c("theatreHours")}+${c("icuHours")}`,
        total: "same",
      },
    ],
    report.rows,
    words,
    { totals: true },
  );
  return done(workbook);
}

// -------------------------------------------- 7. statutory compliance --

interface StatutoryLine {
  unit: string;
  category: string;
  due: number;
  done: number;
  overdue: number;
}

export async function statutoryComplianceWorkbook(
  report: StatutoryComplianceReport,
  i18n: I18nService,
): Promise<Buffer> {
  const words = new Words(i18n);
  const workbook = newBook();
  const sheet = workbook.addWorksheet(SHEET.data);
  const { next } = writeMeta(sheet, words, report.meta, []);
  const lines: StatutoryLine[] = report.rows.flatMap((row) =>
    row.cells.map((cell) => ({
      unit: row.orgUnitName,
      category: words.el(`statutory.${cell.category}`),
      due: cell.due,
      done: cell.done,
      overdue: cell.overdue,
    })),
  );
  const donePct = (c: (key: string) => string) => `IF(${c("due")}=0,"",${c("done")}/${c("due")}*100)`;
  const table = writeTable<StatutoryLine>(
    sheet,
    next,
    [
      { key: "unit", width: 40, input: (l) => l.unit },
      { key: "category", width: 30, input: (l) => l.category },
      { key: "due", width: 13, fmt: INT, input: (l) => l.due, total: "sum" },
      { key: "done", width: 15, fmt: INT, input: (l) => l.done, total: "sum" },
      { key: "overdue", width: 13, fmt: INT, input: (l) => l.overdue, total: "sum" },
      { key: "donePct", width: 16, fmt: PCT, formula: donePct, total: "same" },
    ],
    lines,
    words,
    { totals: true },
  );

  const summary = workbook.addWorksheet(SHEET.summary);
  const sumIf = (key: string, categoryCell: string) => {
    const values = table.range(key);
    const categories = table.range("category");
    return values && categories ? `SUMIFS(${data(values)},${data(categories)},${categoryCell})` : "0";
  };
  interface CategoryLine {
    label: string;
  }
  writeTable<CategoryLine>(
    summary,
    1,
    [
      { key: "category", width: 30, text: (l) => l.label },
      { key: "due", width: 13, fmt: INT, formula: (c) => sumIf("due", c("category")), colour: "link", total: "sum" },
      { key: "done", width: 15, fmt: INT, formula: (c) => sumIf("done", c("category")), colour: "link", total: "sum" },
      { key: "overdue", width: 13, fmt: INT, formula: (c) => sumIf("overdue", c("category")), colour: "link", total: "sum" },
      { key: "donePct", width: 16, fmt: PCT, formula: donePct, total: "same" },
    ],
    STATUTORY_ORDER.map((category) => ({ label: words.el(`statutory.${category}`) })),
    words,
    { totals: true },
  );
  return done(workbook);
}
