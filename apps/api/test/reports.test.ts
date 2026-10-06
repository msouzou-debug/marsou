import type { INestApplication } from "@nestjs/common";
import {
  AssetLifecycleReport,
  BacklogByBandReport,
  BacklogSummaryRow,
  CapitalProgrammeReport,
  ClinicalDisruptionReport,
  ContractorScorecardReport,
  DisruptionHoursRow,
  ExceptionsReport,
  PortfolioResponse,
  REPORT_CATALOGUE,
  REPORT_SLUG,
  RISK_BAND_ORDER,
  type ReportKey,
  StatutoryCategory,
  StatutoryComplianceReport,
} from "@ecapital/shared";
import ExcelJS from "exceljs";
import { Client } from "pg";
import request from "supertest";
import type { ZodType } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, allProjects, bearer, createTestApp, tokenFor } from "./app";
import { binary } from "./maintenance-support";

/**
 * M6 — Αναφορές (R39, ADR-0032) through the API. The suites share one
 * database (ADR-0012), so nothing here pins a global count: each figure is
 * checked against the service it comes from, read by the same caller at the
 * same time, or against the seeded rows by a stable key.
 */

const ESTATES_LARNACA = "estates.larnaca@ecapital.test";
const NICOSIA = "nicosia-general";
const LARNACA = "larnaca-general";

const SCHEMA: Record<ReportKey, ZodType> = {
  CAPITAL_PROGRAMME: CapitalProgrammeReport,
  EXCEPTIONS: ExceptionsReport,
  CONTRACTOR_SCORECARD: ContractorScorecardReport,
  BACKLOG_BY_BAND: BacklogByBandReport,
  ASSET_LIFECYCLE: AssetLifecycleReport,
  CLINICAL_DISRUPTION: ClinicalDisruptionReport,
  STATUTORY_COMPLIANCE: StatutoryComplianceReport,
};
const KEYS = Object.keys(SCHEMA) as ReportKey[];

/** The unit ids a report's rows name, whatever the shape. */
function unitsOf(key: ReportKey, body: Record<string, unknown>): string[] {
  if (key === "CONTRACTOR_SCORECARD") return [];
  const rows = body.rows as Record<string, unknown>[];
  return rows.map((row) =>
    key === "CAPITAL_PROGRAMME" ? (row.orgUnit as { id: string }).id : (row.orgUnitId as string),
  );
}

describe("reports (M6)", () => {
  let app: INestApplication;
  let admin: Client;

  beforeAll(async () => {
    app = await createTestApp();
    admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function report<T>(key: ReportKey, email: string, query = ""): Promise<T> {
    const token = await tokenFor(app, email);
    const response = await http()
      .get(`/reports/${REPORT_SLUG[key]}${query ? `?${query}` : ""}`)
      .set(bearer(token));
    expect(response.status, `${key} ${JSON.stringify(response.body)}`).toBe(200);
    return SCHEMA[key].parse(response.body) as T;
  }

  async function workbook(key: ReportKey, email: string, query = ""): Promise<{
    book: ExcelJS.Workbook;
    disposition: string;
  }> {
    const token = await tokenFor(app, email);
    const response = await http()
      .get(`/reports/${REPORT_SLUG[key]}.xlsx${query ? `?${query}` : ""}`)
      .set(bearer(token))
      .buffer()
      .parse(binary);
    expect(response.status, key).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(response.body);
    return { book, disposition: String(response.headers["content-disposition"]) };
  }

  // ------------------------------------------------------------ access --

  it("lists the catalogue the screen reads", async () => {
    const token = await tokenFor(app, USERS.executive);
    const response = await http().get("/reports").set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(REPORT_CATALOGUE);
  });

  it("answers every report, as JSON and as a workbook, for the five roles and 403 for the others", async () => {
    for (const email of [USERS.admin, USERS.estatesNicosia, USERS.finance, USERS.executive, USERS.auditor]) {
      for (const key of KEYS) await report(key, email);
    }
    for (const email of [USERS.engineerLarnaca, USERS.technicianNicosia, USERS.clinicalNicosia]) {
      const token = await tokenFor(app, email);
      expect((await http().get("/reports").set(bearer(token))).status).toBe(403);
      for (const key of KEYS) {
        expect((await http().get(`/reports/${REPORT_SLUG[key]}`).set(bearer(token))).status, key).toBe(403);
        expect((await http().get(`/reports/${REPORT_SLUG[key]}.xlsx`).set(bearer(token))).status, key).toBe(403);
      }
    }
  });

  it("shows a Larnaca head of estates Larnaca and nothing of Nicosia", async () => {
    for (const key of KEYS) {
      const body = await report<Record<string, unknown>>(key, ESTATES_LARNACA);
      const units = unitsOf(key, body);
      expect(units, key).not.toContain(NICOSIA);
      if (key !== "EXCEPTIONS" && key !== "ASSET_LIFECYCLE" && key !== "CONTRACTOR_SCORECARD") {
        expect(new Set(units), key).toEqual(new Set([LARNACA]));
      }
    }
    const scorecard = await report<ContractorScorecardReport>("CONTRACTOR_SCORECARD", ESTATES_LARNACA);
    expect(scorecard.maintenance.map((s) => s.contractRef)).not.toContain("Α.Ο 42/24");
    // A unit the caller cannot see does not exist for them.
    const token = await tokenFor(app, ESTATES_LARNACA);
    const hidden = await http().get(`/reports/backlog-by-band?orgUnitId=${NICOSIA}`).set(bearer(token));
    expect(hidden.status).toBe(404);
  });

  it("narrows every report to one unit and stamps it in the meta", async () => {
    for (const key of KEYS) {
      const body = await report<Record<string, unknown> & { meta: { orgUnitId: string | null; orgUnitName: string | null } }>(
        key,
        USERS.admin,
        `orgUnitId=${NICOSIA}`,
      );
      expect(body.meta.orgUnitId, key).toBe(NICOSIA);
      expect(body.meta.orgUnitName, key).toBeTruthy();
      for (const unit of unitsOf(key, body)) expect(unit, key).toBe(NICOSIA);
    }
    const whole = await report<CapitalProgrammeReport>("CAPITAL_PROGRAMME", USERS.admin);
    expect(whole.meta.orgUnitId).toBeNull();
    expect(whole.rows.length).toBeGreaterThan(1);
  });

  it("refuses a query it cannot use, in Greek by default and in English on request", async () => {
    const token = await tokenFor(app, USERS.admin);
    for (const query of [
      "year=1999",
      "year=abc",
      "from=2026-09-01&to=2026-07-01",
      "from=2026-07-01&to=2026-07-01",
      "from=2026-02-30",
    ]) {
      const response = await http().get(`/reports/contractor-scorecard?${query}`).set(bearer(token));
      expect(response.status, query).toBe(400);
      expect(response.body.key).toBe("errors.reportQueryNotValid");
    }
    const greek = await http().get("/reports/capital-programme?year=1999").set(bearer(token));
    expect(greek.body.message).toMatch(/αναφοράς/);
    const english = await http()
      .get("/reports/capital-programme?year=1999")
      .set(bearer(token))
      .set("Accept-Language", "en");
    expect(english.body.message).toMatch(/report filters/);
  });

  // ------------------------------------------------- 1. capital programme --

  it("agrees with the portfolio on every unit's approved, committed, projects and RAG", async () => {
    for (const email of [USERS.admin, ESTATES_LARNACA, USERS.estatesNicosia]) {
      const token = await tokenFor(app, email);
      const portfolio = PortfolioResponse.parse(
        (await http().get("/portfolio").set(bearer(token))).body,
      );
      const capital = await report<CapitalProgrammeReport>("CAPITAL_PROGRAMME", email);
      expect(capital.rows.map((r) => r.orgUnit.id).sort()).toEqual(portfolio.units.map((u) => u.orgUnit.id).sort());
      for (const row of capital.rows) {
        const unit = portfolio.units.find((u) => u.orgUnit.id === row.orgUnit.id);
        expect(row.approved).toBeCloseTo(unit?.approved ?? Number.NaN, 2);
        expect(row.committed).toEqual(unit?.committed ?? null);
        expect(row.projectCount).toBe(unit?.projectCount);
        expect(row.rag).toEqual(unit?.rag);
        if (row.forecast === null) expect(row.slippage).toBeNull();
        else expect(row.slippage).toBeCloseTo(row.forecast - row.approved, 2);
        if (row.spent === null || row.approved === 0) expect(row.spentPct).toBeNull();
        else expect(row.spentPct).toBeCloseTo((row.spent / row.approved) * 100, 1);
      }
      expect(capital.rows.reduce((sum, r) => sum + r.approved, 0)).toBeCloseTo(portfolio.kpis.approved, 2);
    }
  });

  it("puts the year elapsed at 100 for a past year and 0 for a future one", async () => {
    expect((await report<CapitalProgrammeReport>("CAPITAL_PROGRAMME", USERS.admin, "year=2025")).yearElapsedPct).toBe(100);
    expect((await report<CapitalProgrammeReport>("CAPITAL_PROGRAMME", USERS.admin, "year=2030")).yearElapsedPct).toBe(0);
    const now = await report<CapitalProgrammeReport>("CAPITAL_PROGRAMME", USERS.admin);
    expect(now.meta.year).toBe(new Date().getUTCFullYear());
    expect(now.yearElapsedPct).toBeGreaterThan(0);
    expect(now.yearElapsedPct).toBeLessThan(100);
  });

  // -------------------------------------------------------- 2. exceptions --

  it("lists exactly the amber and red projects the caller sees, red first", async () => {
    for (const email of [USERS.admin, ESTATES_LARNACA]) {
      const body = await report<ExceptionsReport>("EXCEPTIONS", email);
      const { items } = await allProjects(app, email);
      const flagged = items.filter((p) => p.rag !== "GREEN").map((p) => p.id);
      expect(body.rows.map((r) => r.projectId).sort()).toEqual(flagged.sort());
      expect(body.rows.every((r) => r.rag === "AMBER" || r.rag === "RED")).toBe(true);
      const firstAmber = body.rows.findIndex((r) => r.rag === "AMBER");
      if (firstAmber >= 0) expect(body.rows.slice(firstAmber).every((r) => r.rag === "AMBER")).toBe(true);
    }
    const seeded = await report<ExceptionsReport>("EXCEPTIONS", USERS.admin);
    expect(seeded.rows.some((r) => r.rag === "RED")).toBe(true);
  });

  // ------------------------------------------ 3. contractor scorecard --

  it("scores every active maintenance agreement for the period and the capital contractors", async () => {
    const body = await report<ContractorScorecardReport>(
      "CONTRACTOR_SCORECARD",
      USERS.admin,
      "from=2026-07-01&to=2026-10-01",
    );
    expect(body.meta).toMatchObject({ from: "2026-07-01", to: "2026-10-01", year: null });
    expect(body.maintenance.map((s) => s.contractRef)).toContain("Α.Ο 42/24");
    expect(body.maintenance.every((s) => s.from === "2026-07-01" && s.to === "2026-10-01")).toBe(true);
    for (const row of body.capital) {
      expect(row.overdueContracts).toBeLessThanOrEqual(row.contracts);
      expect(row.openDefects).toBeLessThanOrEqual(row.defects);
    }

    const defaulted = await report<ContractorScorecardReport>("CONTRACTOR_SCORECARD", USERS.admin);
    expect(defaulted.meta.from).toMatch(/^\d{4}-(01|04|07|10)-01$/);
    expect(defaulted.meta.from! < defaulted.meta.to!).toBe(true);

    const nicosia = await report<ContractorScorecardReport>(
      "CONTRACTOR_SCORECARD",
      USERS.admin,
      `orgUnitId=${LARNACA}`,
    );
    expect(nicosia.maintenance.map((s) => s.contractRef)).not.toContain("Α.Ο 42/24");
    const wholeContracts = body.capital.reduce((sum, r) => sum + r.contracts, 0);
    expect(nicosia.capital.reduce((sum, r) => sum + r.contracts, 0)).toBeLessThanOrEqual(wholeContracts);
  });

  // --------------------------------------------------- 4. backlog by band --

  it("carries all four bands per unit and the same figures as the backlog summary", async () => {
    const body = await report<BacklogByBandReport>("BACKLOG_BY_BAND", USERS.admin);
    const token = await tokenFor(app, USERS.admin);
    const summary = (await http().get("/backlog/summary").set(bearer(token))).body.map((row: unknown) =>
      BacklogSummaryRow.parse(row),
    ) as BacklogSummaryRow[];
    for (const row of body.rows) {
      expect(row.bands.map((b) => b.riskBand)).toEqual(RISK_BAND_ORDER);
      for (const cell of row.bands) {
        const hit = summary.find((s) => s.orgUnitId === row.orgUnitId && s.riskBand === cell.riskBand);
        expect(cell.count).toBe(hit?.count ?? 0);
        expect(cell.costEstimate).toBeCloseTo(hit?.costEstimate ?? 0, 2);
        expect(cell.unfundedCost).toBeCloseTo(hit?.unfundedCost ?? 0, 2);
      }
      expect(row.total).toBeCloseTo(row.funded + row.unfunded, 2);
    }
    expect(body.rows.find((r) => r.orgUnitId === NICOSIA)?.total).toBeGreaterThan(0);
  });

  // ---------------------------------------------------- 5. asset lifecycle --

  it("gives the seeded booster pump the cost, calls and downtime its work orders hold", async () => {
    const { rows: found } = await admin.query<{ id: string }>(
      "select id from ecapital.asset where serial_no = 'WI-2016-1102' and org_unit_id = $1",
      [NICOSIA],
    );
    expect(found).toHaveLength(1);
    const assetId = found[0].id;
    const year = new Date().getUTCFullYear();

    const body = await report<AssetLifecycleReport>("ASSET_LIFECYCLE", USERS.estatesNicosia, `orgUnitId=${NICOSIA}`);
    const pump = body.rows.find((r) => r.assetId === assetId);
    expect(pump).toBeDefined();

    const { rows: orders } = await admin.query<{
      cost: string | null;
      corrective: number;
      downtime: string | null;
    }>(
      `select sum(cost_actual)::text as cost,
              count(*) filter (where kind = 'CORRECTIVE' and status <> 'CANCELLED')::int as corrective,
              sum(case when kind = 'CORRECTIVE' and status <> 'CANCELLED'
                       then greatest(0, round((extract(epoch from (coalesce(restored_at, completed_at, cancelled_at, now()) - called_at)) / 3600)::numeric, 2))
                  end)::text as downtime
         from ecapital.work_order where asset_id = $1`,
      [assetId],
    );
    expect(pump?.correctiveOrders).toBe(orders[0].corrective);
    expect(pump?.correctiveOrders).toBeGreaterThanOrEqual(3);
    expect(pump?.maintenanceCost).toBeCloseTo(Number(orders[0].cost ?? 0), 2);
    expect(pump?.maintenanceCost).toBeGreaterThanOrEqual(1800 + 650 + 2400);
    expect(pump?.downtimeHours).toBeCloseTo(Number(orders[0].downtime ?? 0), 1);
    expect(pump).toMatchObject({
      capitalCost: 27000,
      installedYear: 2016,
      expectedLifeYears: 15,
      remainingLifeYears: 2016 + 15 - year,
      replacementYear: 2028,
    });
    expect(pump?.maintenanceToCapitalPct).toBeCloseTo(((pump?.maintenanceCost ?? 0) / 27000) * 100, 1);

    // Shortest remaining life first, the unknown last.
    const known = body.rows.filter((r) => r.remainingLifeYears !== null).map((r) => r.remainingLifeYears as number);
    expect(known).toEqual([...known].sort((a, b) => a - b));
    const firstUnknown = body.rows.findIndex((r) => r.remainingLifeYears === null);
    if (firstUnknown >= 0) expect(body.rows.slice(firstUnknown).every((r) => r.remainingLifeYears === null)).toBe(true);
  });

  // ------------------------------------------------ 6. clinical disruption --

  it("gives twelve months per unit with the disruption-hours service's figures", async () => {
    const year = new Date().getUTCFullYear();
    const body = await report<ClinicalDisruptionReport>("CLINICAL_DISRUPTION", USERS.admin, `year=${year}`);
    const token = await tokenFor(app, USERS.admin);
    const hours = (await http().get(`/calendar/disruption-hours?year=${year}`).set(bearer(token))).body.map(
      (row: unknown) => DisruptionHoursRow.parse(row),
    ) as DisruptionHoursRow[];
    for (const row of body.rows) {
      expect(row.months.map((m) => m.month)).toEqual(
        Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`),
      );
      const mine = hours.filter((h) => h.orgUnitId === row.orgUnitId);
      expect(row.theatreHoursTotal).toBeCloseTo(mine.reduce((sum, h) => sum + h.theatreHours, 0), 1);
      expect(row.icuHoursTotal).toBeCloseTo(mine.reduce((sum, h) => sum + h.icuHours, 0), 1);
      expect(row.permitsTotal).toBe(mine.reduce((sum, h) => sum + h.permits, 0));
    }
  });

  // ---------------------------------------------- 7. statutory compliance --

  it("gives four categories per unit, in order, with done and overdue inside due", async () => {
    const body = await report<StatutoryComplianceReport>("STATUTORY_COMPLIANCE", USERS.admin);
    for (const row of body.rows) {
      expect(row.cells.map((c) => c.category)).toEqual(StatutoryCategory.options);
      for (const cell of row.cells) {
        expect(cell.done + cell.overdue).toBeLessThanOrEqual(cell.due);
        if (cell.due === 0) expect(cell.donePct).toBeNull();
      }
    }
    // Nicosia's programme has fire and medical-gas lines on seeded assets.
    const nicosia = body.rows.find((r) => r.orgUnitId === NICOSIA);
    expect(nicosia?.cells.reduce((sum, c) => sum + c.due, 0)).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------- workbooks --

  it("names every workbook ecapital-<slug>-<year|from_to>.xlsx and starts it with «Στοιχεία»", async () => {
    const year = new Date().getUTCFullYear();
    for (const key of KEYS) {
      const entry = REPORT_CATALOGUE.find((e) => e.key === key);
      const query = entry?.takesPeriod ? "from=2026-07-01&to=2026-10-01" : "year=2025";
      const { book, disposition } = await workbook(key, USERS.auditor, query);
      const stamp = entry?.takesPeriod ? "2026-07-01_2026-10-01" : entry?.takesYear ? "2025" : String(year);
      expect(disposition, key).toContain(`ecapital-${REPORT_SLUG[key]}-${stamp}.xlsx`);
      expect(book.worksheets[0].name, key).toBe("Στοιχεία");
      expect(book.worksheets.map((s) => s.name), key).toContain("Σύνοψη");
      const meta = book.worksheets[0];
      expect(String(meta.getCell("A1").value)).toContain("Αναφορά");
    }
  });

  it("writes the capital programme's inputs blue, its derived columns as black formulas and the year elapsed amber", async () => {
    const json = await report<CapitalProgrammeReport>("CAPITAL_PROGRAMME", USERS.admin);
    const { book } = await workbook("CAPITAL_PROGRAMME", USERS.admin);
    const sheet = book.getWorksheet("Στοιχεία") as ExcelJS.Worksheet;

    const assumption = sheet.getCell("B5");
    expect(assumption.value).toBeCloseTo(json.yearElapsedPct, 0);
    expect((assumption.fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFBF00");
    expect(assumption.note).toBeTruthy();

    const header = findRow(sheet, "Μονάδα");
    const col = (title: string) => findColumn(sheet, header, title);
    const first = header + 2;
    const approved = sheet.getCell(first, col("Εγκεκριμένος προϋπολογισμός (€)"));
    expect(typeof approved.value).toBe("number");
    expect(approved.font?.color?.argb).toBe("FF0000FF");
    for (const title of ["Απόκλιση πρόβλεψης (€)", "Δαπάνες ως % του εγκεκριμένου", "Δαπάνες μείον ποσοστό έτους (ποσοστιαίες μονάδες)"]) {
      const cell = sheet.getCell(first, col(title));
      expect((cell.value as ExcelJS.CellFormulaValue).formula, title).toBeTruthy();
      expect(cell.font?.color?.argb, title).toBe("FF000000");
    }
    expect((sheet.getCell(first, col("Δαπάνες μείον ποσοστό έτους (ποσοστιαίες μονάδες)")).value as ExcelJS.CellFormulaValue).formula).toContain(
      "$B$5",
    );

    // The totals row is formulas, and a figure the system does not have is blank.
    const totals = first + json.rows.length;
    expect(sheet.getCell(totals, 1).value).toBe("Σύνολο");
    expect((sheet.getCell(totals, col("Εγκεκριμένος προϋπολογισμός (€)")).value as ExcelJS.CellFormulaValue).formula).toMatch(
      /^SUM\(/,
    );
    json.rows.forEach((row, i) => {
      const forecast = sheet.getCell(first + i, col("Πρόβλεψη τελικού κόστους (€)")).value;
      if (row.forecast === null) expect(forecast).toBeNull();
      else expect(forecast).toBeCloseTo(row.forecast, 2);
    });

    const summary = book.getWorksheet("Σύνοψη") as ExcelJS.Worksheet;
    const link = summary.getCell("C3");
    expect((link.value as ExcelJS.CellFormulaValue).formula).toContain("'Στοιχεία'!");
    expect(link.font?.color?.argb).toBe("FF008000");
  });

  it("writes the contractor scorecard's rates as formulas over the 100.000 € base and the period", async () => {
    const { book } = await workbook("CONTRACTOR_SCORECARD", USERS.admin, "from=2026-07-01&to=2026-10-01");
    expect(book.worksheets.map((s) => s.name)).toEqual(["Στοιχεία", "Συντήρηση", "Σύνοψη"]);
    const sheet = book.getWorksheet("Στοιχεία") as ExcelJS.Worksheet;
    const base = sheet.getCell("B7");
    expect(base.value).toBe(100000);
    expect((base.fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFBF00");
    const header = findRow(sheet, "Ανάδοχος");
    const rate = sheet.getCell(header + 2, findColumn(sheet, header, "Ελαττώματα ανά βάση αξίας"));
    const json = await report<ContractorScorecardReport>("CONTRACTOR_SCORECARD", USERS.admin, "from=2026-07-01&to=2026-10-01");
    if (json.capital.length) {
      expect((rate.value as ExcelJS.CellFormulaValue).formula).toContain("$B$7");
    }
    const maintenance = book.getWorksheet("Συντήρηση") as ExcelJS.Worksheet;
    expect((maintenance.getCell("B1").value as ExcelJS.CellFormulaValue).formula).toContain("'Στοιχεία'!$B$5");
    expect(maintenance.getCell("B1").font?.color?.argb).toBe("FF008000");
    const mHeader = findRow(maintenance, "Ανάδοχος");
    const pct = maintenance.getCell(mHeader + 2, findColumn(maintenance, mHeader, "Ανταπόκριση (%)"));
    expect((pct.value as ExcelJS.CellFormulaValue).formula).toMatch(/^IF\(/);
  });

  it("writes every other workbook with blue inputs and black formulas", async () => {
    const checks: [ReportKey, string, string, string][] = [
      ["EXCEPTIONS", "Κωδικός έργου", "Εγκεκριμένος προϋπολογισμός (€)", "Απόκλιση πρόβλεψης (€)"],
      ["BACKLOG_BY_BAND", "Μονάδα", "Υψηλή — κόστος (€)", "Υψηλή — χωρίς χρηματοδότηση (€)"],
      ["ASSET_LIFECYCLE", "Κωδικός", "Σωρευτικό κόστος συντήρησης (€)", "Υπολειπόμενη ζωή (έτη)"],
      ["CLINICAL_DISRUPTION", "Μονάδα", "Ώρες χειρουργείων", "Σύνολο ωρών"],
      ["STATUTORY_COMPLIANCE", "Μονάδα", "Οφειλόμενοι έλεγχοι", "Ολοκληρωμένοι ως % των οφειλόμενων"],
    ];
    for (const [key, first, input, derived] of checks) {
      // The whole organisation for the exceptions: a unit may have none at all.
      const { book } = await workbook(key, USERS.admin, key === "EXCEPTIONS" ? "" : `orgUnitId=${NICOSIA}`);
      const sheet = book.getWorksheet("Στοιχεία") as ExcelJS.Worksheet;
      const header = findRow(sheet, first);
      expect(sheet.getCell(header + 2, 1).value, key).not.toBe("Σύνολο");
      const row = header + 2;
      const inputCell = sheet.getCell(row, findColumn(sheet, header, input));
      const derivedCell = sheet.getCell(row, findColumn(sheet, header, derived));
      expect(inputCell.font?.color?.argb, key).toBe("FF0000FF");
      expect((derivedCell.value as ExcelJS.CellFormulaValue).formula, key).toBeTruthy();
      expect(derivedCell.font?.color?.argb, key).toBe("FF000000");
    }
    const { book } = await workbook("STATUTORY_COMPLIANCE", USERS.admin, `orgUnitId=${NICOSIA}`);
    const summary = book.getWorksheet("Σύνοψη") as ExcelJS.Worksheet;
    const due = summary.getCell("B3");
    expect((due.value as ExcelJS.CellFormulaValue).formula).toContain("SUMIFS('Στοιχεία'!");
    expect(due.font?.color?.argb).toBe("FF008000");
  });
});

/** The first row whose column A reads `title`: the Greek header row of the table. */
function findRow(sheet: ExcelJS.Worksheet, title: string): number {
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    if (sheet.getCell(r, 1).value === title) return r;
  }
  throw new Error(`no row «${title}» on ${sheet.name}`);
}

function findColumn(sheet: ExcelJS.Worksheet, row: number, title: string): number {
  const header = sheet.getRow(row);
  for (let c = 1; c <= header.cellCount; c += 1) {
    if (header.getCell(c).value === title) return c;
  }
  throw new Error(`no column «${title}» on ${sheet.name}`);
}
