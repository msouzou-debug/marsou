import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { BacklogItem } from "@ecapital/shared";
import {
  SCORE_CONTRACT,
  SCORE_FROM,
  SCORE_ORDERS,
  SCORE_TO,
} from "../../test/maintenance-fixture";
import { I18nService } from "../common/i18n.service";
import {
  SHEET,
  backlogWorkbook,
  scorecardWorkbook,
  slaTemplateWorkbook,
  type ScoreExportOrder,
} from "./maintenance-export";
import { SLA_COLUMNS } from "./sla-import";

/**
 * RULE (owner): every calculated cell is a formula, never the answer pasted
 * in. These read the workbooks back with exceljs and check that the cells
 * that are calculations carry `formula`, and that the inputs they name are
 * values.
 */
const i18n = new I18nService("el");

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

function formula(cell: ExcelJS.Cell): string | undefined {
  return (cell.value as { formula?: string } | null)?.formula;
}

describe("the scorecard workbook", () => {
  const exportRows: ScoreExportOrder[] = SCORE_ORDERS.map((o) => ({
    ref: o.ref,
    kind: o.kind,
    status: o.status,
    band: o.band,
    system: `${o.slaSystemCode} — ${o.slaSystemName}`,
    assetTag: o.assetId,
    calledAt: o.calledAt,
    dueResponseAt: o.dueResponseAt,
    respondedAt: o.respondedAt,
    dueRestoreAt: o.dueRestoreAt,
    restoreMetAt: o.restoredAt ?? o.completedAt,
    dueReportAt: o.dueReportAt,
    reportReceivedAt: o.reportReceivedAt,
    completedAt: o.completedAt,
    dueDate: o.dueDate,
    penaltyResponsePerHour: o.penaltyResponsePerHour,
    penaltyRestorePerHour: o.penaltyRestorePerHour,
    penaltyPmPerDay: o.penaltyPmPerDay,
  }));

  async function build() {
    return load(
      await scorecardWorkbook(
        {
          contract: { id: "c", ref: "Α.Ο 1/26", contractorName: "Ανάδοχος", ...SCORE_CONTRACT },
          from: SCORE_FROM,
          to: SCORE_TO,
          now: "2026-04-10T00:00:00.000Z",
          orders: SCORE_ORDERS,
        },
        exportRows,
        i18n,
      ),
    );
  }

  it("has «Εντολές» with one row per order and every derived column a formula", async () => {
    const workbook = await build();
    const orders = workbook.getWorksheet(SHEET.orders);
    expect(orders).toBeDefined();
    const sheet = orders as ExcelJS.Worksheet;
    expect(sheet.getCell("A1").value).toBe("Αριθμός εντολής");
    expect(sheet.getCell("A2").value).toBe("Work order");
    expect(sheet.getCell("A3").value).toBe("O1");
    expect(sheet.getCell(`A${2 + SCORE_ORDERS.length}`).value).toBe("P3");
    // Hours late, downtime, the period flags and each line's penalty.
    for (const column of ["J", "M", "P", "S", "T", "X", "Y", "Z", "AA", "AD", "AE", "AF", "AG", "AH"]) {
      expect(formula(sheet.getCell(`${column}3`)), column).toBeTruthy();
    }
    // The facts are values: the call is a date, the rates are numbers.
    expect(sheet.getCell("G3").value).toBeInstanceOf(Date);
    expect(sheet.getCell("U3").value).toBe(10);
    // The moment of calculation is an input on the other sheet, named here.
    expect(formula(sheet.getCell("J3"))).toContain("'Αξιολόγηση'!$B$5");
  });

  it("has «Αξιολόγηση» whose inputs are values and every figure below them a formula", async () => {
    const workbook = await build();
    const sheet = workbook.getWorksheet(SHEET.scorecard) as ExcelJS.Worksheet;
    expect(sheet.getCell("B6").value).toBe(8600);
    expect(sheet.getCell("B7").value).toBe(5);
    expect(sheet.getCell("B9").value).toBe(100000);
    expect(formula(sheet.getCell("B10"))).toContain("8760-B6");

    let formulas = 0;
    let values = 0;
    sheet.eachRow((row, rowNo) => {
      if (rowNo <= 10) return;
      row.eachCell((cell, column) => {
        if (column < 2) return;
        if (formula(cell)) formulas += 1;
        else if (typeof cell.value === "number") values += 1;
      });
    });
    // Not one pasted number below the inputs.
    expect(values).toBe(0);
    expect(formulas).toBeGreaterThan(25);

    let totalRow = 0;
    sheet.eachRow((row, rowNo) => {
      if (row.getCell(1).value === "Σύνολο ρητρών (€)") totalRow = rowNo;
    });
    expect(totalRow).toBeGreaterThan(0);
    expect(formula(sheet.getCell(`B${totalRow}`))).toMatch(/^SUM\(B\d+:B\d+\)$/);
  });
});

describe("the backlog workbook", () => {
  const item = (overrides: Partial<BacklogItem>): BacklogItem => ({
    id: "i",
    orgUnitId: "nicosia-general",
    kind: "REPLACEMENT",
    titleEl: "Αντικατάσταση",
    descriptionEl: null,
    riskBand: "HIGH",
    costEstimate: 1000,
    assetId: null,
    assetTag: null,
    assetName: null,
    slaSystemId: null,
    slaSystemName: null,
    sourceWorkOrderId: null,
    sourceWorkOrderRef: null,
    autoDrafted: false,
    autoReason: null,
    historyEl: null,
    status: "OPEN",
    targetProjectId: null,
    targetProjectCode: null,
    raisedById: null,
    raisedByName: "Σύστημα",
    raisedAt: "2026-10-01T00:00:00.000Z",
    closedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  });

  it("writes the items as values and the unit × band summary as COUNTIFS and SUMIFS", async () => {
    const workbook = await load(
      await backlogWorkbook(
        [
          { unitName: "ΓΝ Λευκωσίας", item: item({}) },
          { unitName: "ΓΝ Λευκωσίας", item: item({ riskBand: "LOW", status: "FUNDED", targetProjectCode: "NGH-2026-001" }) },
          { unitName: "ΓΝ Λάρνακας", item: item({ riskBand: "MODERATE", costEstimate: null }) },
        ],
        i18n,
      ),
    );
    const items = workbook.getWorksheet(SHEET.backlog) as ExcelJS.Worksheet;
    expect(items.getCell("B3").value).toBe("Υψηλή");
    expect(items.getCell("F3").value).toBe(1000);
    expect(items.getCell("H4").value).toBe("NGH-2026-001");

    const summary = workbook.getWorksheet(SHEET.backlogSummary) as ExcelJS.Worksheet;
    expect(summary.getCell("A3").value).toBe("ΓΝ Λάρνακας");
    expect(formula(summary.getCell("B3"))).toContain("COUNTIFS('Εκκρεμότητες'!$A$3:$A$5");
    expect(formula(summary.getCell("G3"))).toContain("SUMIFS('Εκκρεμότητες'!$F$3:$F$5");
    expect(formula(summary.getCell("L4"))).toContain('"Ανοικτή"');
    // The totals row is sums of the rows above it.
    expect(formula(summary.getCell("K5"))).toBe("SUM(K3:K4)");
  });
});

describe("the SLA template", () => {
  it("has the import headers in row 1 and one row per line", async () => {
    const workbook = await load(
      await slaTemplateWorkbook([
        {
          code: "1.1.1",
          nameEl: "Κλιματισμός",
          band: "CRITICAL",
          responseHours: 0.5,
          restoreHours: 2,
          reportHours: 24,
          pmFrequencies: ["QUARTERLY"],
          penaltyPmPerDay: null,
          penaltyResponsePerHour: null,
          penaltyRestorePerHour: null,
        },
      ]),
    );
    const sheet = workbook.worksheets[0];
    SLA_COLUMNS.forEach((column, index) => {
      expect(sheet.getRow(1).getCell(index + 1).value).toBe(column.header);
    });
    expect(sheet.getCell("C2").value).toBe("Κρίσιμο");
    expect(sheet.getCell("G2").value).toBe("Τριμηνιαία");
  });
});
