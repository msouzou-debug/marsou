/**
 * ADR-0037 — a project's cash-flow plan, against a real PostgreSQL
 * (ADR-0012): the plan's CRUD, the fallback to the budget spread, who may
 * write it, the Excel round trip and the unit's sum.
 *
 * The suite opens its own project rather than borrowing a seeded one: every
 * figure is asserted to the cent.
 */
import ExcelJS from "exceljs";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { projectAt } from "./contract-support";

interface Row {
  period: string;
  planned: number | null;
  cumulativePlanned: number | null;
  plannedSource?: string | null;
}

describe("project cash-flow plan (ADR-0037)", () => {
  let app: INestApplication;
  let projectId: string;
  let finance: string;

  const get = (path: string) => request(app.getHttpServer()).get(path);
  const put = (path: string) => request(app.getHttpServer()).put(path);
  const post = (path: string) => request(app.getHttpServer()).post(path);
  const month = (rows: Row[], period: string) => rows.find((row) => row.period === period) as Row;

  async function unitJanuary(): Promise<number> {
    const response = await get("/org-units/nicosia-general/cost/cashflow?from=2031-01&to=2031-01").set(bearer(finance));
    expect(response.status).toBe(200);
    return (response.body[0] as Row).planned ?? 0;
  }

  async function workbook(rows: unknown[][]): Promise<Buffer> {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Πλάνο");
    sheet.addRow(["Μήνας (μμ/εεεε)", "Ποσό (€)", "Σημείωση"]);
    sheet.addRow(["Month (mm/yyyy)", "Amount (€)", "Note"]);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await book.xlsx.writeBuffer());
  }

  beforeAll(async () => {
    app = await createTestApp();
    finance = await tokenFor(app, USERS.finance);
    const project = await projectAt(app, "IDEA", "Πλάνο ταμειακής ροής δοκιμής");
    projectId = project.id;
    // A year nobody else in the seed budgets for, so the unit's sum moves
    // only by what this suite does.
    const lines = await put(`/projects/${projectId}/budget-lines`)
      .set(bearer(finance))
      .send({
        lines: [{ budgetYear: 2031, amount: 1_200_000, category: "works", sapGl: null, lineType: "BUDGET" }],
      });
    expect(lines.status).toBe(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it("starts with no plan, and the cash flow spreads the budget over twelve months", async () => {
    const plan = await get(`/projects/${projectId}/cost/cashflow-plan`).set(bearer(finance));
    expect(plan.status).toBe(200);
    expect(plan.body.months).toEqual([]);
    expect(plan.body.total).toBe(0);
    expect(plan.body.approvedBudget).toBe(1_200_000);
    expect(plan.body.difference).toBe(-1_200_000);

    const flow = await get(`/projects/${projectId}/cost/cashflow?from=2031-01&to=2031-12`).set(bearer(finance));
    expect(flow.status).toBe(200);
    expect(flow.body[0].planned).toBe(100_000);
    expect(flow.body[0].plannedSource).toBe("BUDGET");
  });

  it("lets only those who write the budget write the plan", async () => {
    const body = { mode: "replace", months: [{ period: "2031-01", amount: 1, note: null }] };
    // RULE (ADR-0037): `budgetLines` WRITE. The engineer who runs the
    // project reads the plan and does not change it; the auditor neither.
    for (const email of [USERS.estatesNicosia, USERS.auditor]) {
      const token = await tokenFor(app, email);
      const refused = await put(`/projects/${projectId}/cost/cashflow-plan`).set(bearer(token)).send(body);
      expect(refused.status).toBe(403);
      const read = await get(`/projects/${projectId}/cost/cashflow-plan`).set(bearer(token));
      expect(read.status).toBe(200);
      const upload = await post(`/projects/${projectId}/cost/cashflow-plan/import`)
        .set(bearer(token))
        .attach("file", await workbook([["01/2031", 5, null]]), "plan.xlsx");
      expect(upload.status).toBe(403);
    }
  });

  it("replaces the plan, reports its total and the gap to the budget, and the cash flow reads it", async () => {
    const before = await unitJanuary();
    const written = await put(`/projects/${projectId}/cost/cashflow-plan`)
      .set(bearer(finance))
      .send({
        mode: "replace",
        months: [
          { period: "2031-02", amount: 300_000, note: null },
          { period: "2031-01", amount: 200_000, note: "Κινητοποίηση" },
        ],
      });
    expect(written.status).toBe(200);
    expect(written.body.months).toEqual([
      { period: "2031-01", amount: 200_000, note: "Κινητοποίηση" },
      { period: "2031-02", amount: 300_000, note: null },
    ]);
    expect(written.body.total).toBe(500_000);
    // RULE: the plan may differ from the budget; the answer says by how much.
    expect(written.body.difference).toBe(-700_000);
    expect(written.body.updatedByName).toBeTruthy();
    expect(written.body.updatedAt).toBeTruthy();

    const flow = await get(`/projects/${projectId}/cost/cashflow?from=2031-01&to=2031-12`).set(bearer(finance));
    const rows = flow.body as Row[];
    expect(month(rows, "2031-01")).toMatchObject({ planned: 200_000, plannedSource: "PLAN" });
    expect(month(rows, "2031-02")).toMatchObject({ planned: 300_000, cumulativePlanned: 500_000 });
    // The budget spread is gone for this project, not added on top.
    expect(month(rows, "2031-03")).toMatchObject({ planned: null, plannedSource: null, cumulativePlanned: 500_000 });
    expect(month(rows, "2031-12").cumulativePlanned).toBe(500_000);

    // The unit: the same rule per project — this one's twelfth goes, its
    // plan comes in.
    expect(await unitJanuary()).toBeCloseTo(before - 100_000 + 200_000, 2);
  });

  it("upserts some months and leaves the others", async () => {
    const response = await put(`/projects/${projectId}/cost/cashflow-plan`)
      .set(bearer(finance))
      .send({ mode: "upsert", months: [{ period: "2031-03", amount: 100_000 }, { period: "2031-01", amount: 250_000 }] });
    expect(response.status).toBe(200);
    expect(response.body.months.map((m: { period: string; amount: number }) => [m.period, m.amount])).toEqual([
      ["2031-01", 250_000],
      ["2031-02", 300_000],
      ["2031-03", 100_000],
    ]);
    expect(response.body.total).toBe(650_000);
  });

  it("refuses a month that is not a month, a negative amount and a month twice", async () => {
    const send = (months: unknown[]) =>
      put(`/projects/${projectId}/cost/cashflow-plan`).set(bearer(finance)).send({ mode: "replace", months });
    const badMonth = await send([{ period: "2031-13", amount: 1 }]);
    expect(badMonth.status).toBe(400);
    expect(badMonth.body.key).toBe("errors.cashflowPlanNotValid");
    expect((await send([{ period: "2031-01", amount: -1 }])).status).toBe(400);
    const twice = await send([
      { period: "2031-01", amount: 1 },
      { period: "2031-01", amount: 2 },
    ]);
    expect(twice.status).toBe(422);
    expect(twice.body.key).toBe("errors.cashflowPlanPeriodRepeated");

    // Nothing above was saved.
    const plan = await get(`/projects/${projectId}/cost/cashflow-plan`).set(bearer(finance));
    expect(plan.body.total).toBe(650_000);
  });

  it("hands out the plan as a template with a live total and a live difference", async () => {
    const response = await get(`/projects/${projectId}/cost/cashflow-plan/template.xlsx?from=2031-01&to=2031-04`)
      .set(bearer(finance))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(response.body as ArrayBuffer);
    const sheet = book.worksheets[0];
    expect(sheet.getCell("A3").value).toBe("01/2031");
    expect(sheet.getCell("B3").value).toBe(250_000);
    expect(sheet.getCell("A6").value).toBe("04/2031");
    expect(sheet.getCell("B6").value).toBe(0);
    expect(sheet.getCell("F3").formula).toBe("SUM(B:B)");
    expect(sheet.getCell("F4").value).toBe(1_200_000);
    expect(sheet.getCell("F5").formula).toBe("F3-F4");
  });

  it("imports nothing when any row is wrong, and says which rows", async () => {
    const response = await post(`/projects/${projectId}/cost/cashflow-plan/import`)
      .set(bearer(finance))
      .attach(
        "file",
        await workbook([
          ["01/2031", 10, null],
          ["13/2031", 10, null],
          ["02/2031", -10, null],
        ]),
        "plan.xlsx",
      );
    expect(response.status).toBe(200);
    expect(response.body.saved).toBe(false);
    expect(response.body.plan).toBeNull();
    expect(response.body.errors).toEqual([
      { row: 4, problem: "periodNotValid", value: "13/2031" },
      { row: 5, problem: "amountNegative", value: "-10" },
    ]);
    const plan = await get(`/projects/${projectId}/cost/cashflow-plan`).set(bearer(finance));
    expect(plan.body.total).toBe(650_000);
  });

  it("replaces the plan from a clean file, and refuses a file that is not a workbook", async () => {
    const response = await post(`/projects/${projectId}/cost/cashflow-plan/import`)
      .set(bearer(finance))
      .attach("file", await workbook([["05/2031", "1.200.000,00", "Όλο το ποσό"]]), "plan.xlsx");
    expect(response.status).toBe(200);
    expect(response.body.saved).toBe(true);
    expect(response.body.plan.months).toEqual([{ period: "2031-05", amount: 1_200_000, note: "Όλο το ποσό" }]);
    expect(response.body.plan.difference).toBe(0);

    const junk = await post(`/projects/${projectId}/cost/cashflow-plan/import`)
      .set(bearer(finance))
      .attach("file", Buffer.from("όχι excel"), "plan.xlsx");
    expect(junk.status).toBe(400);
    expect(junk.body.key).toBe("errors.cashflowPlanFileNotValid");
  });

  it("falls back to the budget spread once the plan is emptied", async () => {
    const emptied = await put(`/projects/${projectId}/cost/cashflow-plan`)
      .set(bearer(finance))
      .send({ mode: "replace", months: [] });
    expect(emptied.status).toBe(200);
    expect(emptied.body.months).toEqual([]);
    const flow = await get(`/projects/${projectId}/cost/cashflow?from=2031-05&to=2031-05`).set(bearer(finance));
    expect(flow.body[0]).toMatchObject({ planned: 100_000, plannedSource: "BUDGET" });
  });

  it("writes every change of the plan into the audit trail", async () => {
    const admin = await tokenFor(app, USERS.admin);
    const response = await get("/audit-log?entity_type=project_cashflow_plan&limit=200").set(bearer(admin));
    expect(response.status).toBe(200);
    const actions = new Set((response.body as Array<{ action: string }>).map((item) => item.action));
    expect(actions).toEqual(new Set(["INSERT", "UPDATE", "DELETE"]));
  });
});
