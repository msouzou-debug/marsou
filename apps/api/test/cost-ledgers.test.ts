/**
 * R13, R16, R17, R31 — the four ledgers, the forecast, the cash flow and the
 * warn-and-flag rules, against a real PostgreSQL (ADR-0012).
 *
 * The suite builds its own project and contract rather than borrowing from
 * the seed: every figure here is asserted to the cent, and the seed is a demo
 * register other suites write to.
 */
import { Client } from "pg";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract } from "./contract-support";

describe("project cost (R13, R16, R17, R31)", () => {
  let app: INestApplication;
  let db: Client;
  let projectId: string;
  let contractId: string;

  const get = (path: string) => request(app.getHttpServer()).get(path);
  const put = (path: string) => request(app.getHttpServer()).put(path);
  const post = (path: string) => request(app.getHttpServer()).post(path);

  beforeAll(async () => {
    app = await createTestApp();
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await db.connect();

    const made = await makeContract(app, "ledger", {
      originalValue: 1_000_000,
      awardDate: "2026-01-10",
      startDate: "2026-02-01",
      completionDate: "2026-12-31",
      sapPoNumber: "4500911001",
    });
    projectId = made.project.id;
    contractId = made.contract.id;
  });

  afterAll(async () => {
    await db.end();
    await app.close();
  });

  it("keeps a ledger with no source empty rather than zero", async () => {
    const token = await tokenFor(app, USERS.finance);
    const response = await get(`/projects/${projectId}/cost`).set(bearer(token));
    expect(response.status).toBe(200);
    // RULE: the commitment is the contract ledger, because a contract exists;
    // nothing has been posted, so there is no actual spend and the answer is
    // null and not €0.
    expect(response.body.committedSource).toBe("CONTRACTS");
    expect(response.body.ledgers.committed).toBe(1_000_000);
    expect(response.body.ledgers.spent).toBeNull();
    expect(response.body.ledgers.approved).toBe(0);
    expect(response.body.lastSapImportAt).toBeNull();
  });

  it("gives finance the budget lines and refuses everybody else", async () => {
    const finance = await tokenFor(app, USERS.finance);
    const body = {
      lines: [
        { budgetYear: 2026, amount: 800_000, category: "works", sapGl: null, lineType: "BUDGET" },
        { budgetYear: 2027, amount: 400_000, category: "works", sapGl: null, lineType: "BUDGET" },
      ],
    };

    // ADR-0014, owner decision 19/09/2026: after approval the budget is
    // finance's. The engineer who runs the project cannot move it.
    const engineer = await tokenFor(app, USERS.estatesNicosia);
    const refused = await put(`/projects/${projectId}/budget-lines`).set(bearer(engineer)).send(body);
    expect(refused.status).toBe(403);

    const written = await put(`/projects/${projectId}/budget-lines`).set(bearer(finance)).send(body);
    expect(written.status).toBe(200);
    expect(written.body.total).toBe(2);
    expect(written.body.vintageId).toBe("ecapital");

    const cost = await get(`/projects/${projectId}/cost`).set(bearer(finance));
    expect(cost.body.ledgers.approved).toBe(1_200_000);
    const works = cost.body.categories.find((row: { category: string }) => row.category === "works");
    expect(works.approved).toBe(1_200_000);
  });

  it("refuses two lines for the same year and type", async () => {
    const finance = await tokenFor(app, USERS.finance);
    const response = await put(`/projects/${projectId}/budget-lines`)
      .set(bearer(finance))
      .send({
        lines: [
          { budgetYear: 2026, amount: 1, category: "works", sapGl: null, lineType: "BUDGET" },
          { budgetYear: 2026, amount: 2, category: "fees", sapGl: null, lineType: "BUDGET" },
        ],
      });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.budgetYearRepeated");
  });

  it("adds the contingency and the weighted proposals to the forecast", async () => {
    const engineer = await tokenFor(app, USERS.estatesNicosia);
    const response = await put(`/projects/${projectId}/cost/forecast-inputs`)
      .set(bearer(engineer))
      .send({ contingency: 50_000, pendingVariationWeight: 0.5, contingencyNoteEl: "Απρόβλεπτα εργοταξίου" });
    expect(response.status).toBe(200);
    expect(response.body.forecastInputs.contingency).toBe(50_000);
    // R16: committed 1.000.000 + contingency 50.000, nothing pending.
    expect(response.body.ledgers.forecast).toBe(1_050_000);
    expect(response.body.ledgers.costToComplete).toBe(1_050_000);

    const finance = await tokenFor(app, USERS.finance);
    const refused = await put(`/projects/${projectId}/cost/forecast-inputs`)
      .set(bearer(finance))
      .send({ contingency: 0, pendingVariationWeight: 0.5, contingencyNoteEl: null });
    expect(refused.status).toBe(403);
  });

  it("reads the commitment from SAP once an extract has posted one", async () => {
    // CAPEX-01 §7: the commitment is the contract ledger until ingestion is
    // live and the purchase-order balance afterwards, and `committedSource`
    // says which so nobody mixes them without knowing.
    const { rows: unit } = await db.query<{ org_unit_id: string }>(
      "select org_unit_id from ecapital.project where id = $1",
      [projectId],
    );
    await db.query(
      `insert into ecapital.cost_txn
         (org_unit_id, project_id, contract_id, txn_type, source, source_ref,
          doc_date, posting_date, amount, description, matched_by)
       values ($1, $2, $3, 'COMMITMENT', 'SAP_EXTRACT', 'TEST-PO-1',
               '2026-02-01', '2026-02-01', 900000, 'Υπόλοιπο εντολής αγοράς', 'PO')`,
      [unit[0].org_unit_id, projectId, contractId],
    );
    await db.query(
      `insert into ecapital.cost_txn
         (org_unit_id, project_id, contract_id, txn_type, source, source_ref,
          doc_date, posting_date, amount, description, matched_by)
       values ($1, $2, $3, 'ACTUAL', 'SAP_EXTRACT', 'TEST-INV-1',
               '2026-03-01', '2026-03-31', 250000, 'Τιμολόγιο 1', 'PO')`,
      [unit[0].org_unit_id, projectId, contractId],
    );

    const token = await tokenFor(app, USERS.finance);
    const response = await get(`/projects/${projectId}/cost`).set(bearer(token));
    expect(response.body.committedSource).toBe("SAP_PO");
    expect(response.body.ledgers.committed).toBe(900_000);
    expect(response.body.ledgers.spent).toBe(250_000);
    expect(response.body.ledgers.forecast).toBe(950_000);
    expect(response.body.ledgers.costToComplete).toBe(700_000);
  });

  it("spreads the year's budget over its months and counts the postings in theirs", async () => {
    const token = await tokenFor(app, USERS.finance);
    const response = await get(`/projects/${projectId}/cost/cashflow?from=2026-01&to=2026-12`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(12);
    // R17: evenly over twelve months — 800.000 ÷ 12.
    expect(response.body[0].planned).toBeCloseTo(66_666.67, 2);
    expect(response.body[0].actual).toBeNull();
    const march = response.body.find((row: { period: string }) => row.period === "2026-03");
    expect(march.actual).toBe(250_000);
    expect(response.body[11].cumulativePlanned).toBeCloseTo(800_000, 0);
    expect(response.body[11].cumulativeActual).toBe(250_000);
  });

  it("sums the same profile over a whole unit", async () => {
    const token = await tokenFor(app, USERS.finance);
    const response = await get("/org-units/nicosia-general/cost/cashflow?from=2026-01&to=2026-12")
      .set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(12);
    const march = response.body.find((row: { period: string }) => row.period === "2026-03");
    expect(march.actual).toBeGreaterThanOrEqual(250_000);
  });

  it("refuses a window that ends before it starts", async () => {
    const token = await tokenFor(app, USERS.finance);
    const response = await get(`/projects/${projectId}/cost/cashflow?from=2026-12&to=2026-01`)
      .set(bearer(token));
    expect(response.status).toBe(400);
  });

  // --------------------------------------------------------- R31 warnings --

  it("warns when the forecast passes the approved budget, and never blocks", async () => {
    const finance = await tokenFor(app, USERS.finance);
    // One year, well under what has been committed.
    const written = await put(`/projects/${projectId}/budget-lines`)
      .set(bearer(finance))
      .send({
        lines: [
          { budgetYear: 2026, amount: 500_000, category: "works", sapGl: null, lineType: "BUDGET" },
        ],
      });
    // RULE (CAPEX-01 §1): a budget the commitments have passed is still a
    // budget somebody may write. Warn and flag, never block.
    expect(written.status).toBe(200);

    const cost = await get(`/projects/${projectId}/cost`).set(bearer(finance));
    const keys = cost.body.warnings.map((warning: { key: string }) => warning.key).sort();
    expect(keys).toContain("forecastOverApproved");
    expect(keys).toContain("commitmentOverYearBudget");
    const forecast = cost.body.warnings.find(
      (warning: { key: string }) => warning.key === "forecastOverApproved",
    );
    // committed 900.000 + contingency 50.000 − approved 500.000.
    expect(forecast.amount).toBe(450_000);
    // CAPEX-02 §7's glossary term, inside a sentence and in lower case where
    // the grammar puts it there.
    expect(forecast.sentenceEl).toContain("ρόβλεψη τελικού κόστους");
    expect(forecast.sentenceEn).toContain("forecast final cost");
    expect(forecast.dismissedAt).toBeNull();
  });

  it("writes an email to the head of estates rather than sending one", async () => {
    // ADR-0021: there is no SMTP server configured, and inventing one would
    // either send mail nobody asked for or fail the write that produced the
    // warning. The row is written; a sender picks it up when there is one.
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from ecapital.email_outbox
        where entity_type = 'cost_warning' and sent_at is null`,
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("remembers a dismissal, and fires again as a new row when the figure moves", async () => {
    const finance = await tokenFor(app, USERS.finance);
    const before = await get(`/projects/${projectId}/cost`).set(bearer(finance));
    const warning = before.body.warnings.find(
      (row: { key: string }) => row.key === "forecastOverApproved",
    );

    const dismissed = await post(
      `/projects/${projectId}/cost/warnings/${warning.id}/dismiss`,
    ).set(bearer(finance));
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.dismissedByName).not.toBe("");
    expect(dismissed.body.dismissedAt).not.toBeNull();

    // R42: the dismissal is in the audit log as well as in the row.
    const { rows: audit } = await db.query<{ n: number }>(
      "select count(*)::int as n from ecapital.audit_log where entity_type = 'cost_warning' and entity_id = $1 and action = 'UPDATE'",
      [warning.id],
    );
    expect(audit[0].n).toBeGreaterThan(0);

    // Still dismissed at the same figure: re-reading does not resurrect it.
    const again = await get(`/projects/${projectId}/cost`).set(bearer(finance));
    const live = again.body.warnings.filter(
      (row: { key: string; dismissedAt: string | null }) =>
        row.key === "forecastOverApproved" && row.dismissedAt === null,
    );
    expect(live).toHaveLength(0);

    // The figure moves, and the rule fires again as a new row beside it.
    await put(`/projects/${projectId}/budget-lines`)
      .set(bearer(finance))
      .send({
        lines: [
          { budgetYear: 2026, amount: 100_000, category: "works", sapGl: null, lineType: "BUDGET" },
        ],
      });
    const after = await get(`/projects/${projectId}/cost`).set(bearer(finance));
    const refired = after.body.warnings.filter(
      (row: { key: string; dismissedAt: string | null }) =>
        row.key === "forecastOverApproved" && row.dismissedAt === null,
    );
    expect(refired).toHaveLength(1);
    expect(refired[0].id).not.toBe(warning.id);
    expect(refired[0].amount).toBe(850_000);
  });

  it("clears a warning when the condition stops holding", async () => {
    const finance = await tokenFor(app, USERS.finance);
    await put(`/projects/${projectId}/budget-lines`)
      .set(bearer(finance))
      .send({
        lines: [
          { budgetYear: 2026, amount: 5_000_000, category: "works", sapGl: null, lineType: "BUDGET" },
        ],
      });
    const response = await get(`/projects/${projectId}/cost`).set(bearer(finance));
    const live = response.body.warnings.filter(
      (row: { dismissedAt: string | null }) => row.dismissedAt === null,
    );
    expect(live).toHaveLength(0);
  });

  it("exports the category table with the variance and the totals as formulas", async () => {
    const token = await tokenFor(app, USERS.finance);
    const response = await get(`/projects/${projectId}/cost/export`)
      .set(bearer(token))
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml");

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell("A1").value).toBe("Κατηγορία");
    expect(sheet.getCell("A2").value).toBe("Category");
    expect(sheet.getCell("F1").value).toBe("Απόκλιση");
    // The owner's requirement: a formula, never the answer.
    const variance = sheet.getCell("F3").value as { formula?: string };
    expect(variance.formula).toContain("E3-B3");
  });

  it("shows a read-only account the ledgers and refuses it every write", async () => {
    const auditor = await tokenFor(app, USERS.auditor);
    const read = await get(`/projects/${projectId}/cost`).set(bearer(auditor));
    expect(read.status).toBe(200);

    const refused = await put(`/projects/${projectId}/cost/forecast-inputs`)
      .set(bearer(auditor))
      .send({ contingency: 1, pendingVariationWeight: 0.5, contingencyNoteEl: null });
    expect(refused.status).toBe(403);
  });
});
