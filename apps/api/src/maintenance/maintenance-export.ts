/**
 * M5 — the three workbooks: the SLA catalogue template (R32), the backlog
 * (R35) and the contractor scorecard (R37).
 *
 * RULE (owner, the same one cost-export.ts lives by): a calculated cell is a
 * formula, never the answer pasted in. The backlog summary is COUNTIFS and
 * SUMIFS over the item sheet; every ratio, penalty and total on the
 * scorecard is a formula over the order sheet, and the rates, the period and
 * the moment of calculation are input cells those formulas name. Finance
 * withholds money on these figures (ADR-0031 §9), so whoever receives the
 * file has to be able to see the arithmetic and change an input and watch
 * the total move.
 *
 * Times are written as UTC date-times and the column headers say so: the
 * differences are what the formulas read, and a wall-clock conversion would
 * make one hour of every March and October order disappear or double.
 */
import ExcelJS from "exceljs";
import type { BacklogItem, PmFrequency, RiskBand, SlaBand } from "@ecapital/shared";
import type { I18nService } from "../common/i18n.service";
import { SLA_COLUMNS, templateRow } from "./sla-import";
import { HOURS_PER_YEAR, type ScoreInput } from "./scorecard";

const MONEY_FORMAT = "#,##0.00";
const HOURS_FORMAT = "#,##0.00";
const DATE_TIME_FORMAT = "dd/mm/yyyy hh:mm";
const DATE_FORMAT = "dd/mm/yyyy";
const HEADER_FILL = "FFEFEFEF";
const INPUT_FILL = "FFFFF2CC";

/** The sheet names the formulas reach across to. Fixed, because a formula names them. */
export const SHEET = {
  backlog: "Εκκρεμότητες",
  backlogSummary: "Σύνοψη",
  orders: "Εντολές",
  scorecard: "Αξιολόγηση",
  catalogue: "Κατάλογος συστημάτων",
} as const;

type Translate = (key: string, locale: "el" | "en") => string;

function translator(i18n: I18nService): Translate {
  return (key, locale) => i18n.translate(key, locale, {});
}

function styleHeader(row: ExcelJS.Row, bold: boolean): void {
  row.font = { bold, size: 11 };
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function headerRows(sheet: ExcelJS.Worksheet, el: string[], en: string[]): void {
  styleHeader(sheet.addRow(el), true);
  styleHeader(sheet.addRow(en), false);
  sheet.views = [{ state: "frozen", ySplit: 2 }];
}

function quoted(sheet: string): string {
  return `'${sheet.replace(/'/g, "''")}'`;
}

function at(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

// --------------------------------------------------- the SLA template --

export interface TemplateSystem {
  code: string;
  nameEl: string;
  band: SlaBand;
  responseHours: number;
  restoreHours: number;
  reportHours: number;
  pmFrequencies: PmFrequency[];
  penaltyPmPerDay: number | null;
  penaltyResponsePerHour: number | null;
  penaltyRestorePerHour: number | null;
}

/**
 * R32: the import format, with the agreement's current rows in it. One
 * header row in Greek — the contract's own words — because this is the file
 * that comes back in, and the importer finds its columns by these headers.
 */
export async function slaTemplateWorkbook(systems: TemplateSystem[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eCapital";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(SHEET.catalogue);
  styleHeader(sheet.addRow(SLA_COLUMNS.map((c) => c.header)), true);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns = [
    { width: 10 },
    { width: 70 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 28 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
  ];
  for (const system of systems) {
    const row = sheet.addRow(templateRow(system));
    for (const column of [8, 9, 10]) row.getCell(column).numFmt = MONEY_FORMAT;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ------------------------------------------------------- the backlog --

export interface BacklogExportRow {
  unitName: string;
  item: BacklogItem;
}

const BANDS: RiskBand[] = ["HIGH", "SIGNIFICANT", "MODERATE", "LOW"];

/**
 * R35: one row per item, then the unit × band summary as COUNTIFS and
 * SUMIFS over that sheet. The summary counts what is still somebody's to pay
 * for — OPEN and FUNDED, the same two statuses `GET /backlog/summary` reads —
 * and the unfunded column is OPEN alone.
 */
export async function backlogWorkbook(
  rows: BacklogExportRow[],
  i18n: I18nService,
): Promise<Buffer> {
  const t = translator(i18n);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eCapital";
  workbook.created = new Date();

  const items = workbook.addWorksheet(SHEET.backlog);
  const keys = ["unit", "riskBand", "kind", "title", "assetTag", "cost", "status", "projectCode"];
  headerRows(
    items,
    keys.map((key) => t(`maintenance.export.backlog.${key}`, "el")),
    keys.map((key) => t(`maintenance.export.backlog.${key}`, "en")),
  );
  items.columns = [
    { width: 34 },
    { width: 14 },
    { width: 20 },
    { width: 50 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
  ];
  for (const { unitName, item } of rows) {
    const added = items.addRow([
      unitName,
      t(`maintenance.riskBand.${item.riskBand}`, "el"),
      t(`maintenance.backlogKind.${item.kind}`, "el"),
      item.titleEl,
      item.assetTag ?? "",
      item.costEstimate ?? null,
      t(`maintenance.backlogStatus.${item.status}`, "el"),
      item.targetProjectCode ?? "",
    ]);
    added.getCell(6).numFmt = MONEY_FORMAT;
  }

  const first = 3;
  const last = Math.max(first, 2 + rows.length);
  const range = (column: string) => `${quoted(SHEET.backlog)}!$${column}$${first}:$${column}$${last}`;
  const open = t("maintenance.backlogStatus.OPEN", "el");
  const funded = t("maintenance.backlogStatus.FUNDED", "el");

  const summary = workbook.addWorksheet(SHEET.backlogSummary);
  const bandEl = BANDS.map((band) => t(`maintenance.riskBand.${band}`, "el"));
  const bandEn = BANDS.map((band) => t(`maintenance.riskBand.${band}`, "en"));
  const euro = (labels: string[]) => labels.map((label) => `${label} (€)`);
  headerRows(
    summary,
    [
      t("maintenance.export.backlog.unit", "el"),
      ...bandEl,
      t("maintenance.export.summary.countTotal", "el"),
      ...euro(bandEl),
      t("maintenance.export.summary.costTotal", "el"),
      t("maintenance.export.summary.unfunded", "el"),
    ],
    [
      t("maintenance.export.backlog.unit", "en"),
      ...bandEn,
      t("maintenance.export.summary.countTotal", "en"),
      ...euro(bandEn),
      t("maintenance.export.summary.costTotal", "en"),
      t("maintenance.export.summary.unfunded", "en"),
    ],
  );
  summary.columns = [{ width: 34 }, ...Array.from({ length: 11 }, () => ({ width: 16 }))];

  const units = [...new Set(rows.map((row) => row.unitName))].sort((a, b) => a.localeCompare(b, "el"));
  units.forEach((_, index) => {
    const r = 3 + index;
    const live = (criteria: string) =>
      [open, funded]
        .map((status) => `${criteria}${range("G")},"${status}")`)
        .join("+");
    const counts = bandEl.map((band) => ({
      formula: live(`COUNTIFS(${range("A")},$A${r},${range("B")},"${band}",`),
    }));
    const costs = bandEl.map((band) => ({
      formula: live(`SUMIFS(${range("F")},${range("A")},$A${r},${range("B")},"${band}",`),
    }));
    const added = summary.addRow([
      units[index],
      ...counts,
      { formula: `SUM(B${r}:E${r})` },
      ...costs,
      { formula: `SUM(G${r}:J${r})` },
      { formula: `SUMIFS(${range("F")},${range("A")},$A${r},${range("G")},"${open}")` },
    ]);
    for (const column of ["G", "H", "I", "J", "K", "L"]) added.getCell(column).numFmt = MONEY_FORMAT;
  });
  const totalsAt = 3 + units.length;
  const totals = summary.addRow([
    t("maintenance.export.total", "el"),
    ...["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"].map((column) =>
      units.length ? { formula: `SUM(${column}3:${column}${totalsAt - 1})` } : 0,
    ),
  ]);
  totals.font = { bold: true };
  for (const column of ["G", "H", "I", "J", "K", "L"]) totals.getCell(column).numFmt = MONEY_FORMAT;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ----------------------------------------------------- the scorecard --

/**
 * The «Αξιολόγηση» sheet's input cells. The order sheet's formulas name them
 * by these addresses, so they are fixed here once.
 */
const INPUT = {
  from: "$B$3",
  to: "$B$4",
  asOf: "$B$5",
  availabilityHours: "$B$6",
  criticalRate: "$B$7",
  otherRate: "$B$8",
  contractValue: "$B$9",
  allowance: "$B$10",
} as const;

export interface ScoreExportOrder {
  ref: string;
  kind: string;
  status: string;
  band: string | null;
  system: string;
  assetTag: string | null;
  calledAt: string;
  dueResponseAt: string | null;
  respondedAt: string | null;
  dueRestoreAt: string | null;
  /** restoredAt, or completedAt when the order closed without one. */
  restoreMetAt: string | null;
  dueReportAt: string | null;
  reportReceivedAt: string | null;
  completedAt: string | null;
  dueDate: string | null;
  penaltyResponsePerHour: number | null;
  penaltyRestorePerHour: number | null;
  penaltyPmPerDay: number | null;
}

/**
 * R37: «Εντολές» holds one row per order with the facts as values and every
 * derived column — hours late, downtime, on-time flags, the amount each line
 * costs — as a formula over them and over the inputs on «Αξιολόγηση».
 * «Αξιολόγηση» then holds the inputs and nothing but formulas below them.
 * It is the same arithmetic as `computeScorecard`, cell by cell.
 */
export async function scorecardWorkbook(
  input: ScoreInput,
  orders: ScoreExportOrder[],
  i18n: I18nService,
): Promise<Buffer> {
  const t = translator(i18n);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eCapital";
  workbook.created = new Date();

  const sheetOrders = workbook.addWorksheet(SHEET.orders);
  const card = workbook.addWorksheet(SHEET.scorecard);
  const ref = (cell: string) => `${quoted(SHEET.scorecard)}!${cell}`;

  // ------------------------------------------------------- Εντολές --
  const columns = [
    "ref", "kind", "band", "system", "asset", "status", "calledAt",
    "dueResponse", "responded", "lateResponseH",
    "dueRestore", "restored", "lateRestoreH",
    "dueReport", "reportReceived", "lateReportH",
    "completed", "dueDate", "latePmDays", "downtimeH",
    "rateResponse", "rateRestore", "ratePm",
    "inPeriod", "pmInPeriod",
    "onTimeResponse", "onTimeRestore", "onTimeReport", "onTimePm",
    "penaltyResponse", "penaltyRestore", "penaltyPm",
    "rateMissing", "repeatAsset",
  ] as const;
  headerRows(
    sheetOrders,
    columns.map((key) => t(`maintenance.export.orders.${key}`, "el")),
    columns.map((key) => t(`maintenance.export.orders.${key}`, "en")),
  );
  sheetOrders.columns = columns.map((key) => ({
    width: key === "system" ? 40 : key === "ref" ? 18 : 15,
  }));

  const first = 3;
  const last = Math.max(first, 2 + orders.length);
  const asOf = ref(INPUT.asOf);
  const from = ref(INPUT.from);
  const to = ref(INPUT.to);

  orders.forEach((order, index) => {
    const r = first + index;
    const added = sheetOrders.addRow([
      order.ref,
      order.kind,
      order.band ?? "",
      order.system,
      order.assetTag ?? "",
      order.status,
      at(order.calledAt),
      at(order.dueResponseAt),
      at(order.respondedAt),
      // J: hours late on the response; an unanswered call is late up to the
      // moment of calculation.
      { formula: `IF(OR(B${r}="PM",H${r}=""),0,MAX(0,(IF(I${r}="",${asOf},I${r})-H${r})*24))` },
      at(order.dueRestoreAt),
      at(order.restoreMetAt),
      // M: hours late on the restore; K already carries any extension.
      { formula: `IF(OR(B${r}="PM",K${r}=""),0,MAX(0,(IF(L${r}="",${asOf},L${r})-K${r})*24))` },
      at(order.dueReportAt),
      at(order.reportReceivedAt),
      { formula: `IF(OR(B${r}="PM",N${r}=""),0,MAX(0,(IF(O${r}="",${asOf},O${r})-N${r})*24))` },
      at(order.completedAt),
      order.dueDate ? new Date(`${order.dueDate}T00:00:00Z`) : null,
      // S: started days late on a PM visit — one hour late is a day late.
      { formula: `IF(OR(B${r}<>"PM",K${r}=""),0,MAX(0,ROUNDUP(IF(Q${r}="",${asOf},Q${r})-K${r},0)))` },
      // T: calendar hours down, corrective only, from the call to the restore.
      { formula: `IF(B${r}<>"CORRECTIVE",0,MAX(0,(IF(L${r}<>"",L${r},${asOf})-G${r})*24))` },
      order.penaltyResponsePerHour,
      order.penaltyRestorePerHour,
      order.penaltyPmPerDay,
      // X: called inside the period and not withdrawn.
      { formula: `IF(AND(F${r}<>"CANCELLED",G${r}>=${from},G${r}<${to}),1,0)` },
      // Y: a PM visit whose programme date is inside the period.
      { formula: `IF(AND(B${r}="PM",F${r}<>"CANCELLED",R${r}<>"",R${r}>=${from},R${r}<${to}),1,0)` },
      { formula: `IF(AND(H${r}<>"",I${r}<>"",I${r}<=H${r}),1,0)` },
      { formula: `IF(AND(K${r}<>"",L${r}<>"",L${r}<=K${r}),1,0)` },
      { formula: `IF(AND(N${r}<>"",O${r}<>"",O${r}<=N${r}),1,0)` },
      { formula: `IF(AND(B${r}="PM",K${r}<>"",Q${r}<>"",Q${r}<=K${r}),1,0)` },
      { formula: `IF(X${r}=1,J${r}*N(U${r}),0)` },
      { formula: `IF(X${r}=1,M${r}*N(V${r}),0)` },
      { formula: `IF(Y${r}=1,S${r}*N(W${r}),0)` },
      // AG: a late line whose system has no rate — counted, not priced.
      {
        formula: `IF(OR(AND(X${r}=1,J${r}>0,U${r}=""),AND(X${r}=1,M${r}>0,V${r}=""),AND(Y${r}=1,S${r}>0,W${r}="")),1,0)`,
      },
      // AH: 1 on the first corrective order of an asset that has three or
      // more in the period, so the column sums to the number of assets.
      {
        formula: `IF(AND(B${r}="CORRECTIVE",X${r}=1,E${r}<>"",COUNTIFS(E$${first}:E${r},E${r},B$${first}:B${r},"CORRECTIVE",X$${first}:X${r},1)=1,COUNTIFS(E$${first}:E$${last},E${r},B$${first}:B$${last},"CORRECTIVE",X$${first}:X$${last},1)>=3),1,0)`,
      },
    ]);
    for (const column of [7, 8, 9, 11, 12, 14, 15, 17]) added.getCell(column).numFmt = DATE_TIME_FORMAT;
    added.getCell(18).numFmt = DATE_FORMAT;
    for (const column of [10, 13, 16, 20]) added.getCell(column).numFmt = HOURS_FORMAT;
    for (const column of [21, 22, 23, 30, 31, 32]) added.getCell(column).numFmt = MONEY_FORMAT;
  });

  // ---------------------------------------------------- Αξιολόγηση --
  const o = (column: string) => `${quoted(SHEET.orders)}!$${column}$${first}:$${column}$${last}`;
  card.columns = [{ width: 52 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  const label = (key: string) => t(`maintenance.export.scorecard.${key}`, "el");

  const title = card.addRow([
    `${label("title")} — ${input.contract.contractorName} — ${input.contract.ref}`,
  ]);
  title.font = { bold: true, size: 13 };
  styleHeader(card.addRow([label("inputs"), label("value"), t("maintenance.export.scorecard.inputs", "en")]), true);

  const inputRow = (key: string, value: ExcelJS.CellValue, numFmt?: string) => {
    const row = card.addRow([label(key), value, t(`maintenance.export.scorecard.${key}`, "en")]);
    const cell = row.getCell(2);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_FILL } };
    if (numFmt) cell.numFmt = numFmt;
    return row;
  };
  inputRow("from", new Date(`${input.from.slice(0, 10)}T00:00:00Z`), DATE_FORMAT); // row 3
  inputRow("to", new Date(`${input.to.slice(0, 10)}T00:00:00Z`), DATE_FORMAT); // row 4
  inputRow("asOf", new Date(input.now), DATE_TIME_FORMAT); // row 5
  inputRow("availabilityHours", input.contract.availabilityHoursYear); // row 6
  inputRow("criticalRate", input.contract.availabilityPenaltyCriticalPerHour, MONEY_FORMAT); // row 7
  inputRow("otherRate", input.contract.availabilityPenaltyOtherPerHour, MONEY_FORMAT); // row 8
  inputRow("contractValue", input.contract.contractValue, MONEY_FORMAT); // row 9
  // Row 10: the pro-rata allowance. A formula over the inputs above it, and
  // the cell every availability formula below names.
  inputRow(
    "allowance",
    { formula: `MAX(0,(${HOURS_PER_YEAR}-B6)*(B4-B3)/365)` },
    HOURS_FORMAT,
  );

  const section = (key: string, extra: string[] = []) => {
    card.addRow([]);
    styleHeader(card.addRow([label(key), ...extra]), true);
  };
  const line = (key: string, values: ExcelJS.CellValue[], numFmt?: string) => {
    const row = card.addRow([label(key), ...values]);
    if (numFmt) values.forEach((_, index) => (row.getCell(2 + index).numFmt = numFmt));
    return row;
  };

  section("orders"); // rows 11-12
  line("total", [{ formula: `SUM(${o("X")})` }]); // 13
  line("corrective", [{ formula: `COUNTIFS(${o("X")},1,${o("B")},"CORRECTIVE")` }]);
  line("pm", [{ formula: `COUNTIFS(${o("X")},1,${o("B")},"PM")` }]);
  line("statutory", [{ formula: `COUNTIFS(${o("X")},1,${o("B")},"STATUTORY")` }]);
  line("open", [{ formula: `COUNTIFS(${o("X")},1,${o("F")},"<>COMPLETED")` }]); // 17

  section("timers", [label("due"), label("onTime"), label("pct")]); // 18-19
  const ratio = (key: string, dueFormula: string, onTimeFormula: string) => {
    const r = card.rowCount + 1;
    line(key, [
      { formula: dueFormula },
      { formula: onTimeFormula },
      { formula: `IF(B${r}=0,"",C${r}/B${r}*100)` },
    ]).getCell(4).numFmt = "0.0";
  };
  ratio(
    "response",
    `COUNTIFS(${o("X")},1,${o("B")},"<>PM",${o("H")},"<>")`,
    `SUMIFS(${o("Z")},${o("X")},1,${o("B")},"<>PM",${o("H")},"<>")`,
  ); // 20
  ratio(
    "restore",
    `COUNTIFS(${o("X")},1,${o("B")},"<>PM",${o("K")},"<>")`,
    `SUMIFS(${o("AA")},${o("X")},1,${o("B")},"<>PM",${o("K")},"<>")`,
  ); // 21
  ratio(
    "report",
    `COUNTIFS(${o("X")},1,${o("B")},"<>PM",${o("N")},"<>")`,
    `SUMIFS(${o("AB")},${o("X")},1,${o("B")},"<>PM",${o("N")},"<>")`,
  ); // 22
  ratio("pmVisits", `SUM(${o("Y")})`, `SUMIFS(${o("AC")},${o("Y")},1)`); // 23

  section("availability");
  const critical = line(
    "criticalDowntime",
    [{ formula: `SUMIFS(${o("T")},${o("X")},1,${o("C")},"CRITICAL")` }],
    HOURS_FORMAT,
  ).number;
  const other = line(
    "otherDowntime",
    [{ formula: `SUMIFS(${o("T")},${o("X")},1)-B${critical}` }],
    HOURS_FORMAT,
  ).number;
  const availability = line(
    "availabilityPenalty",
    [
      {
        formula: `MAX(0,B${critical}-${INPUT.allowance})*${INPUT.criticalRate}+MAX(0,B${other}-${INPUT.allowance})*${INPUT.otherRate}`,
      },
    ],
    MONEY_FORMAT,
  ).number;

  section("penalties");
  const pmPenalty = line("penaltyPm", [{ formula: `SUM(${o("AF")})` }], MONEY_FORMAT).number;
  line("penaltyResponse", [{ formula: `SUM(${o("AD")})` }], MONEY_FORMAT);
  line("penaltyRestore", [{ formula: `SUM(${o("AE")})` }], MONEY_FORMAT);
  const availabilityLine = line(
    "penaltyAvailability",
    [{ formula: `B${availability}` }],
    MONEY_FORMAT,
  ).number;
  const totalRow = line(
    "penaltyTotal",
    [{ formula: `SUM(B${pmPenalty}:B${availabilityLine})` }],
    MONEY_FORMAT,
  );
  totalRow.font = { bold: true };
  line(
    "capUsed",
    [
      {
        formula: `IF(N(${INPUT.contractValue})>0,B${totalRow.number}/${INPUT.contractValue}*100,"")`,
      },
    ],
    "0.00",
  );
  line("ratesMissing", [
    {
      formula: `IF(SUM(${o("AG")})>0,"${label("yes")}","${label("no")}")`,
    },
  ]); // 37
  line("repeatFailures", [{ formula: `SUM(${o("AH")})` }]); // 38

  section("byBand", [label("corrective"), label("responsePct"), label("restorePct"), label("downtime")]);
  for (const band of ["CRITICAL", "P1", "P2"] as const) {
    const bandCriteria = `${o("X")},1,${o("B")},"<>PM",${o("C")},"${band}"`;
    const row = card.addRow([
      t(`maintenance.slaBand.${band}`, "el"),
      { formula: `COUNTIFS(${o("X")},1,${o("B")},"CORRECTIVE",${o("C")},"${band}")` },
      {
        formula: `IF(COUNTIFS(${bandCriteria},${o("H")},"<>")=0,"",SUMIFS(${o("Z")},${bandCriteria},${o("H")},"<>")/COUNTIFS(${bandCriteria},${o("H")},"<>")*100)`,
      },
      {
        formula: `IF(COUNTIFS(${bandCriteria},${o("K")},"<>")=0,"",SUMIFS(${o("AA")},${bandCriteria},${o("K")},"<>")/COUNTIFS(${bandCriteria},${o("K")},"<>")*100)`,
      },
      { formula: `SUMIFS(${o("T")},${o("X")},1,${o("C")},"${band}")` },
    ]);
    row.getCell(3).numFmt = "0.0";
    row.getCell(4).numFmt = "0.0";
    row.getCell(5).numFmt = HOURS_FORMAT;
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
