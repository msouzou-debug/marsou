/**
 * ADR-0036 — SAP capital lines, end to end against a real PostgreSQL
 * (ADR-0012).
 *
 * What it proves:
 *  - the capital lines profile reads the connector's CSV (comma), a Greek
 *    client's CSV (semicolon) and the Excel file, with ISO and dd.mm.yyyy
 *    dates, dot and comma decimals and a credit note negative;
 *  - the matching order for CAPEX_LINES: the CAP- reference, then vendor
 *    number plus net amount plus document date against one booked eFinance
 *    invoice, then the remembered rules by vendor number and text and by
 *    vendor number alone, then the queue;
 *  - the vendor name on a line is eFinance's;
 *  - a line on a contract eFinance holds leaves the spent ledger alone, and
 *    on one it does not, it counts;
 *  - the connector reader against a fake connector, configured and not;
 *  - the reconciliation report and its workbook.
 *
 * Its own dates (2031) and its own vendor numbers (7001xx), so nothing
 * another suite writes lands in its period.
 */
import { readFileSync } from "node:fs";
import type { INestApplication } from "@nestjs/common";
import { ProjectCost, SapReconciliationReport } from "@ecapital/shared";
import ExcelJS from "exceljs";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SapExtractReader } from "../src/cost/source/sap-extract.reader";
import { SapMcpReader } from "../src/cost/source/sap-mcp.reader";
import type { RawCostRow } from "../src/cost/source/cost-source";
import { USERS, bearer, createAppWith, createTestApp, tokenFor } from "./app";
import { makeContract } from "./contract-support";
import { type CapexLine, capexLinesFixture, capexLinesSheet, csvOf, sapFixturePath, xlsxOf } from "./fixtures/build-sap-fixtures";
import { binary } from "./maintenance-support";
import { FAKE_SAP_KEY, FakeSapConnector } from "./sap-connector-fake";

async function rowsOf(fileName: string, content: Buffer): Promise<RawCostRow[]> {
  const rows: RawCostRow[] = [];
  for await (const row of new SapExtractReader().read({
    report: "CAPEX_LINES",
    period: "2026-10",
    payload: { fileName, content },
  })) {
    rows.push(row);
  }
  return rows;
}

const VENDOR_NAME = "ΠΡΟΜΗΘΕΥΤΗΣ ΔΟΚΙΜΗΣ ΓΡΑΜΜΩΝ SAP ΛΤΔ";

describe("SAP capital lines (ADR-0036)", () => {
  let app: INestApplication;
  let db: Client;
  const stamp = Date.now();
  type Made = Awaited<ReturnType<typeof makeContract>>;
  let a: Made; // matched by its CAP- reference, not on eFinance
  let b: Made; // matched by an eFinance invoice
  let c: Made; // two equal eFinance invoices: ambiguous
  let d: Made; // pushed to eFinance: reconciliation only
  let firstBatch: string;

  const http = () => request(app.getHttpServer());

  async function upload(lines: CapexLine[], period: string, name: string, format: "csv" | "xlsx" = "csv") {
    const token = await tokenFor(app, USERS.finance);
    const sheet = capexLinesSheet(lines);
    const content = format === "csv" ? csvOf(sheet, ",") : await xlsxOf(sheet);
    return http()
      .post("/cost/imports")
      .set(bearer(token))
      .field("report", "CAPEX_LINES")
      .field("period", period)
      .field("dryRun", "false")
      .attach("file", content, `${name}.${format}`);
  }

  async function lineOf(batchId: string, document: string) {
    const { rows } = await db.query<{
      id: string;
      project_id: string | null;
      contract_id: string | null;
      matched_by: string;
      vendor_no: string | null;
      vendor_name: string | null;
      contract_ref: string | null;
      invoice_ref: string | null;
      efinance_invoice_id: string | null;
      amount: string;
      txn_type: string;
      source: string;
    }>("select * from ecapital.cost_txn where import_batch_id = $1 and source_ref like $2", [batchId, `${document}/%`]);
    expect(rows, document).toHaveLength(1);
    return rows[0];
  }

  async function spentOf(projectId: string): Promise<number | null> {
    const token = await tokenFor(app, USERS.finance);
    const response = await http().get(`/projects/${projectId}/cost`).set(bearer(token));
    expect(response.status).toBe(200);
    return ProjectCost.parse(response.body).ledgers.spent;
  }

  async function invoice(id: string, made: Made, net: number, date: string, vendor: string) {
    await db.query(
      `insert into ecapital.efinance_invoice
         (id, org_unit_id, contract_id, invoice_no, invoice_date, vendor_code, vendor_name, currency,
          net, vat, gross, status, ledger, cap_ref, updated_at, raw)
       values ($1, $2, $3, $4, $5::date, $6, 'Δοκιμή', 'EUR', $7, 0, $7, 'booked', 'booked', $8, now(), '{}'::jsonb)`,
      [id, made.contract.orgUnitId, made.contract.id, `INV-${id}`, date, vendor, net, made.contract.ref],
    );
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await db.connect();

    a = await makeContract(app, `capex-a-${stamp}`);
    b = await makeContract(app, `capex-b-${stamp}`);
    c = await makeContract(app, `capex-c-${stamp}`);
    d = await makeContract(app, `capex-d-${stamp}`);
    // The SAP vendor number lives on the contractor (0003); one with SAP's
    // ten-place padding, to prove the padding does not matter.
    const vendors: [Made, string][] = [[a, "0000700101"], [b, "700102"], [c, "700103"], [d, "700104"]];
    for (const [made, vendor] of vendors) {
      await db.query("update ecapital.contractor set sap_vendor_id = $2 where id = $1", [made.contractorId, vendor]);
    }
    await db.query("update ecapital.contract set efinance_pushed_at = now() where id = $1", [d.contract.id]);

    await invoice(`capex-test-${stamp}-a1`, a, 900, "2031-03-05", "700101");
    await invoice(`capex-test-${stamp}-b1`, b, 12345.67, "2031-03-10", "700102");
    await invoice(`capex-test-${stamp}-c1`, c, 500, "2031-03-11", "700103");
    await invoice(`capex-test-${stamp}-c2`, c, 500, "2031-03-12", "700103");

    await db.query(
      `insert into ecapital.efinance_vendor (vendor_code, name) values ('0000700199', $1)
       on conflict (vendor_code) do update set name = excluded.name`,
      [VENDOR_NAME],
    );
  });

  afterAll(async () => {
    await db.end();
    await app.close();
  });

  // --------------------------------------------------------------- profile --

  it("reads the capital lines from the connector's CSV, a Greek CSV and the Excel file alike", async () => {
    const files: [string, Buffer][] = [
      ["capexlines.csv", readFileSync(sapFixturePath("capexlines.csv"))],
      ["capexlines.xlsx", readFileSync(sapFixturePath("capexlines.xlsx"))],
      ["capexlines-greek.csv", csvOf(capexLinesFixture(), ";")],
    ];
    for (const [name, content] of files) {
      const rows = await rowsOf(name, content);
      expect(rows, name).toHaveLength(6);
      expect(rows.flatMap((row) => row.problems), name).toEqual([]);
      const [first, second, credit, assigned, creditGreek] = rows;
      expect(first, name).toMatchObject({
        sourceRef: "5100000001/1",
        docDate: "2026-10-05",
        postingDate: "2026-10-06",
        amount: 12345.67,
        description: "Τιμολόγιο εργασιών 1",
        vendorNo: "0000100201",
        contractRef: "CAP-2026-9001",
        invoiceRef: "INV-001",
        glAccount: "0802100",
        costCentre: "CC1001",
      });
      // dd.mm.yyyy and a comma decimal in the same file as ISO and a dot.
      expect(second, name).toMatchObject({ docDate: "2026-10-07", postingDate: "2026-10-08", amount: 1000.5, contractRef: null });
      // RULE (ADR-0036 §1): debit positive, credit negative, as delivered.
      expect(credit.amount, name).toBe(-250);
      expect(creditGreek.amount, name).toBe(-1234.56);
      // No text: the assignment stands in.
      expect(assigned.description, name).toBe("ΑΝΑΘ-44");
    }
  });

  // -------------------------------------------------------------- matching --

  it("matches by CAP- reference, then by one eFinance invoice, and queues the rest", async () => {
    const aBefore = await spentOf(a.project.id);
    const dBefore = await spentOf(d.project.id);
    expect(aBefore).toBeNull();
    expect(dBefore).toBeNull();

    const base = { companyCode: "1000", fiscalYear: "2031", period: "3", currency: "EUR", glAccount: "0802100" };
    const response = await upload(
      [
        // (a) the reference names contract A.
        { ...base, document: "7100000001", item: "1", documentDate: "2031-03-02", postingDate: "2031-03-03", amount: "1000.00", text: "Πιστοποίηση 1", reference: "A-1", vendor: "0000700101", contractReference: a.contract.ref },
        // (b) a reference that names no contract, then vendor + net + date (two days off) → B's invoice.
        { ...base, document: "7100000002", item: "1", documentDate: "2031-03-12", postingDate: "2031-03-13", amount: "12345.67", text: "Τιμολόγιο Β", reference: "B-1", vendor: "0000700102", contractReference: "CAP-2031-9999" },
        // Two equal invoices on C: a question for a person, not a match.
        { ...base, document: "7100000003", item: "1", documentDate: "2031-03-11", postingDate: "2031-03-11", amount: "500.00", text: "Τιμολόγιο Γ", reference: "C-1", vendor: "700103" },
        // A vendor eFinance knows by name, nothing to match on.
        { ...base, document: "7100000004", item: "1", documentDate: "2031-03-14", postingDate: "2031-03-14", amount: "77.77", text: "Συντήρηση ανελκυστήρα 03/2031", reference: "E-1", vendor: "700199" },
        // (a) again, on the contract eFinance holds.
        { ...base, document: "7100000005", item: "1", documentDate: "2031-03-15", postingDate: "2031-03-15", amount: "2500.00", text: "Πιστοποίηση Δ", reference: "D-1", vendor: "700104", contractReference: d.contract.ref },
        // B's vendor and amount again, ten days off and the invoice already taken.
        { ...base, document: "7100000006", item: "1", documentDate: "2031-03-20", postingDate: "2031-03-20", amount: "12345.67", text: "Τιμολόγιο Β", reference: "B-2", vendor: "700102" },
        // A vendor with no text at all.
        { ...base, document: "7100000007", item: "1", documentDate: "2031-03-21", postingDate: "2031-03-21", amount: "10.00", text: "", reference: "F-1", vendor: "700198" },
      ],
      "2031-03",
      `CAPEX_LINES_2031_03_${stamp}`,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({
      report: "CAPEX_LINES",
      source: "SAP_EXTRACT",
      profileId: "sap_capex_lines_v1",
      rowsIn: 7,
      rowsMatched: 3,
      rowsUnmatched: 4,
      rowsRejected: 0,
      status: "PENDING_ALLOCATION",
    });
    firstBatch = response.body.id;

    const lineA = await lineOf(firstBatch, "7100000001");
    expect(lineA).toMatchObject({
      matched_by: "CONTRACT_REF",
      contract_id: a.contract.id,
      project_id: a.project.id,
      vendor_no: "0000700101",
      contract_ref: a.contract.ref,
      invoice_ref: "A-1",
      txn_type: "ACTUAL",
      source: "SAP_EXTRACT",
    });

    const lineB = await lineOf(firstBatch, "7100000002");
    expect(lineB).toMatchObject({
      matched_by: "EFINANCE_INVOICE",
      contract_id: b.contract.id,
      project_id: b.project.id,
      efinance_invoice_id: `capex-test-${stamp}-b1`,
      contract_ref: "CAP-2031-9999",
    });

    expect(await lineOf(firstBatch, "7100000003")).toMatchObject({ matched_by: "NONE", project_id: null, vendor_name: "700103" });
    // ADR-0036 §6: the name is eFinance's, found through SAP's padding.
    expect(await lineOf(firstBatch, "7100000004")).toMatchObject({ matched_by: "NONE", vendor_name: VENDOR_NAME });
    expect(await lineOf(firstBatch, "7100000005")).toMatchObject({ matched_by: "CONTRACT_REF", contract_id: d.contract.id });
    expect(await lineOf(firstBatch, "7100000006")).toMatchObject({ matched_by: "NONE", efinance_invoice_id: null });

    // ADR-0036 §3: a line on a contract eFinance does not know counts as
    // spent; on one eFinance holds it is reconciliation only.
    expect(await spentOf(a.project.id)).toBe(1000);
    expect(await spentOf(b.project.id)).toBe(12345.67);
    expect(await spentOf(d.project.id)).toBeNull();

    const token = await tokenFor(app, USERS.finance);
    const queue = await http().get(`/cost/imports/${firstBatch}/unmatched`).set(bearer(token));
    expect(queue.status).toBe(200);
    expect(queue.body.remaining).toBe(4);
    const queued = queue.body.items.map((item: { txn: { vendorNo: string; sourceRef: string } }) => item.txn);
    expect(queued.map((t: { vendorNo: string }) => t.vendorNo).sort()).toEqual(["700102", "700103", "700198", "700199"]);
  });

  it("remembers an allocation by vendor number and text, and by vendor number alone", async () => {
    const token = await tokenFor(app, USERS.finance);
    const lift = await lineOf(firstBatch, "7100000004");
    const untitled = await lineOf(firstBatch, "7100000007");
    for (const line of [lift, untitled]) {
      const allocated = await http()
        .post(`/cost/imports/${firstBatch}/allocate`)
        .set(bearer(token))
        .send({ txnIds: [line.id], projectId: a.project.id, contractId: a.contract.id, remember: true });
      expect(allocated.status, JSON.stringify(allocated.body)).toBe(200);
    }
    const { rows: rules } = await db.query<{ vendor_no: string; vendor_name: string; text_norm: string }>(
      "select vendor_no, vendor_name, text_norm from ecapital.allocation_rule where vendor_no in ('700199', '700198') order by vendor_no",
    );
    expect(rules).toEqual([
      { vendor_no: "700198", vendor_name: "700198", text_norm: "" },
      { vendor_no: "700199", vendor_name: VENDOR_NAME, text_norm: "συντηρηση ανελκυστηρα" },
    ]);

    const base = { companyCode: "1000", fiscalYear: "2031", period: "4", currency: "EUR", glAccount: "0802100" };
    const response = await upload(
      [
        // Same vendor (padded this time) and the same narrative, another month.
        { ...base, document: "7200000001", item: "1", documentDate: "2031-04-14", postingDate: "2031-04-14", amount: "77.77", text: "Συντήρηση ανελκυστήρα 04/2031", vendor: "0000700199" },
        // Same vendor, a narrative nobody has allocated: the queue.
        { ...base, document: "7200000002", item: "1", documentDate: "2031-04-15", postingDate: "2031-04-15", amount: "50.00", text: "Άλλη εργασία", vendor: "700199" },
        // The vendor remembered on its own takes any narrative.
        { ...base, document: "7200000003", item: "1", documentDate: "2031-04-16", postingDate: "2031-04-16", amount: "20.00", text: "Οτιδήποτε", vendor: "700198" },
      ],
      "2031-04",
      `CAPEX_LINES_2031_04_${stamp}`,
      "xlsx",
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const batch = response.body.id;
    expect(await lineOf(batch, "7200000001")).toMatchObject({ matched_by: "RULE", project_id: a.project.id, contract_id: a.contract.id });
    expect(await lineOf(batch, "7200000002")).toMatchObject({ matched_by: "NONE", project_id: null });
    expect(await lineOf(batch, "7200000003")).toMatchObject({ matched_by: "RULE", project_id: a.project.id });

    // S10 suggests the remembered vendor for the one left over.
    const queue = await http().get(`/cost/imports/${batch}/unmatched`).set(bearer(token));
    const left = queue.body.items[0];
    expect(left.txn.vendorNo).toBe("700199");
    expect(left.suggestions.some((s: { reason: string; projectId: string }) => s.reason === "REMEMBERED_VENDOR" && s.projectId === a.project.id)).toBe(true);
  });

  // -------------------------------------------------------------- connector --

  it("calls the connector when it is configured and reads its CSV with the same profile", async () => {
    const fake = new FakeSapConnector();
    await fake.start();
    const configured = await createAppWith({ SAP_CONNECTOR_URL: `${fake.url}/`, SAP_CONNECTOR_KEY: FAKE_SAP_KEY });
    try {
      fake.csv = csvOf(
        capexLinesSheet([
          { companyCode: "1000", fiscalYear: "2031", period: "5", document: "7300000001", item: "1", documentDate: "2031-05-04", postingDate: "2031-05-05", glAccount: "0802100", amount: "3000.00", currency: "EUR", text: "Πιστοποίηση 2", reference: "A-2", vendor: "700101", contractReference: a.contract.ref },
          { companyCode: "1000", fiscalYear: "2031", period: "5", document: "7300000002", item: "1", documentDate: "2031-05-06", postingDate: "2031-05-06", glAccount: "0802100", amount: "-120.00", currency: "EUR", text: "Πιστωτικό", reference: "X-1", vendor: "700197" },
        ]),
        ",",
      ).toString("utf8");
      const token = await tokenFor(configured, USERS.finance);
      const call = () =>
        request(configured.getHttpServer())
          .post("/cost/imports/sap-connector")
          .set(bearer(token))
          .send({ fiscalYear: 2031, periodFrom: 5, periodTo: 5, dryRun: false });

      const response = await call();
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body).toMatchObject({
        source: "SAP_MCP",
        report: "CAPEX_LINES",
        period: "2031-05",
        rowsIn: 2,
        rowsMatched: 1,
        rowsUnmatched: 1,
        amountIn: 2880,
      });
      // ASSUMPTION (sap-mcp.reader.ts): the route SAP administration named,
      // our query names, the key as a bearer token.
      expect(fake.calls.at(-1)).toEqual({
        path: "/v1/export/capexlines",
        query: { fiscalYear: "2031", periodFrom: "5", periodTo: "5", format: "csv" },
        authorization: `Bearer ${FAKE_SAP_KEY}`,
      });
      const line = await lineOf(response.body.id, "7300000001");
      expect(line).toMatchObject({ source: "SAP_MCP", matched_by: "CONTRACT_REF", contract_id: a.contract.id });

      // The same lines twice are the same file twice.
      const again = await call();
      expect(again.status).toBe(409);
      expect(again.body.key).toBe("errors.costImportDuplicate");

      // The connector refusing is upstream's fault: 502, and nothing about the key.
      fake.status = 500;
      const failed = await request(configured.getHttpServer())
        .post("/cost/imports/sap-connector")
        .set(bearer(token))
        .send({ fiscalYear: 2031, periodFrom: 6, periodTo: 6 });
      expect(failed.status).toBe(502);
      expect(failed.body.key).toBe("errors.sapConnectorFailed");
      expect(JSON.stringify(failed.body)).not.toContain(FAKE_SAP_KEY);
      fake.status = null;

      // A key the connector does not accept is the same 502.
      const wrongKey = new SapMcpReader({ url: fake.url, key: "another-test-key-not-a-secret" });
      await expect(async () => {
        for await (const row of wrongKey.read({
          report: "CAPEX_LINES",
          period: "2031-05",
          payload: { fiscalYear: 2031, periodFrom: 5, periodTo: 5 },
        })) {
          throw new Error(`read a row with the wrong key: ${JSON.stringify(row)}`);
        }
      }).rejects.toMatchObject({ messageKey: "errors.sapConnectorFailed", params: { code: "HTTP_401" } });

      const bad = await request(configured.getHttpServer())
        .post("/cost/imports/sap-connector")
        .set(bearer(token))
        .send({ fiscalYear: 2031, periodFrom: 7, periodTo: 6 });
      expect(bad.status).toBe(400);
      expect(bad.body.key).toBe("errors.sapConnectorQueryNotValid");

      // Only the roles that import.
      const engineer = await tokenFor(configured, USERS.engineerLarnaca);
      const refused = await request(configured.getHttpServer())
        .post("/cost/imports/sap-connector")
        .set(bearer(engineer))
        .send({ fiscalYear: 2031, periodFrom: 5, periodTo: 5 });
      expect(refused.status).toBe(403);
    } finally {
      await configured.close();
      await fake.stop();
    }
  });

  it("answers «not configured» without the connector's URL and key", async () => {
    const token = await tokenFor(app, USERS.finance);
    const response = await http()
      .post("/cost/imports/sap-connector")
      .set(bearer(token))
      .send({ fiscalYear: 2031, periodFrom: 5, periodTo: 5 });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.costSourceNotConfigured");

    // A URL without a key, or a key left as the template's CHANGE-ME, is not configured either.
    for (const reader of [new SapMcpReader({ url: "http://127.0.0.1:9" }), new SapMcpReader({ url: "http://127.0.0.1:9", key: "CHANGE-ME" })]) {
      expect(reader.configured).toBe(false);
    }
  });

  // --------------------------------------------------------- reconciliation --

  it("reconciles SAP against eFinance per contract and per vendor, with a status each", async () => {
    const token = await tokenFor(app, USERS.finance);
    const response = await http()
      .get("/reports/sap-reconciliation?from=2031-03-01&to=2031-04-01")
      .set(bearer(token));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const report = SapReconciliationReport.parse(response.body);
    expect(report.meta).toMatchObject({ key: "SAP_RECONCILIATION", from: "2031-03-01", to: "2031-04-01", year: null });

    const byContract = (id: string) => report.rows.find((row) => row.contractId === id);
    const byVendor = (vendor: string) => report.rows.find((row) => row.contractId === null && row.vendorNo === vendor);

    // A: SAP 1000 (by reference) plus the two allocated lines (77.77 and
    // 10.00, now on A's contract) against eFinance's 900.
    expect(byContract(a.contract.id)).toMatchObject({
      contractRef: a.contract.ref,
      projectCode: a.project.code,
      vendorNo: "0000700101",
      sapLines: 3,
      sapAmount: 1087.77,
      efinanceInvoices: 1,
      efinanceAmount: 900,
      difference: 187.77,
      status: "DIFFERENCE",
      linesWithoutRef: 2,
    });
    expect(byContract(b.contract.id)).toMatchObject({
      sapAmount: 12345.67,
      efinanceAmount: 12345.67,
      difference: 0,
      status: "MATCHED",
      linesWithoutRef: 0,
    });
    expect(byContract(c.contract.id)).toMatchObject({
      sapLines: 0,
      sapAmount: 0,
      efinanceInvoices: 2,
      efinanceAmount: 1000,
      difference: -1000,
      status: "EFINANCE_ONLY",
    });
    expect(byContract(d.contract.id)).toMatchObject({ sapAmount: 2500, efinanceAmount: 0, status: "SAP_ONLY" });
    // No contract found: per vendor.
    expect(byVendor("700103")).toMatchObject({ sapLines: 1, sapAmount: 500, status: "SAP_ONLY", linesWithoutRef: 1 });
    expect(byVendor("700102")).toMatchObject({ sapAmount: 12345.67, status: "SAP_ONLY", linesWithoutRef: 1 });

    // Largest absolute difference first.
    const gaps = report.rows.map((row) => Math.abs(row.difference));
    expect([...gaps].sort((x, y) => y - x)).toEqual(gaps);
    // Totals and what is still in the queue for the period (the two left there).
    const sum = (pick: (row: (typeof report.rows)[number]) => number) =>
      Math.round(report.rows.reduce((total, row) => total + pick(row), 0) * 100) / 100;
    expect(report.totals.sapAmount).toBeCloseTo(sum((row) => row.sapAmount), 2);
    expect(report.totals.efinanceAmount).toBeCloseTo(sum((row) => row.efinanceAmount), 2);
    expect(report.totals.difference).toBeCloseTo(report.totals.sapAmount - report.totals.efinanceAmount, 2);
    expect(report.unmatchedLines).toBe(2);
    expect(report.unmatchedAmount).toBeCloseTo(12845.67, 2);

    // A unit filter narrows to that unit's contracts and drops the queue, which belongs to no unit.
    const larnaca = await http()
      .get("/reports/sap-reconciliation?from=2031-03-01&to=2031-04-01&orgUnitId=larnaca-general")
      .set(bearer(token));
    expect(larnaca.status).toBe(200);
    expect(larnaca.body.rows.map((row: { contractId: string }) => row.contractId)).not.toContain(a.contract.id);
    expect(larnaca.body.unmatchedLines).toBe(0);
  });

  it("writes the reconciliation as one sheet, the difference and the totals as live formulas", async () => {
    const token = await tokenFor(app, USERS.auditor);
    const response = await http()
      .get("/reports/sap-reconciliation.xlsx?from=2031-03-01&to=2031-04-01")
      .set(bearer(token))
      .buffer()
      .parse(binary);
    expect(response.status).toBe(200);
    expect(String(response.headers["content-disposition"])).toContain("ecapital-sap-reconciliation-2031-03-01_2031-04-01.xlsx");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(response.body);
    expect(book.worksheets.map((s) => s.name)).toEqual(["Στοιχεία"]);
    const sheet = book.worksheets[0];

    let header = 0;
    for (let r = 1; r <= sheet.rowCount; r += 1) if (sheet.getCell(r, 1).value === "Κωδικός σύμβασης") header = r;
    expect(header).toBeGreaterThan(0);
    const column = (title: string) => {
      const row = sheet.getRow(header);
      for (let col = 1; col <= row.cellCount; col += 1) if (row.getCell(col).value === title) return col;
      throw new Error(`no column ${title}`);
    };
    const sap = column("Ποσό SAP (€)");
    const efinance = column("Ποσό eFinance (€)");
    const difference = column("Διαφορά SAP μείον eFinance (€)");
    const status = column("Κατάσταση συμφωνίας");

    const first = header + 2;
    expect(typeof sheet.getCell(first, sap).value).toBe("number");
    expect(sheet.getCell(first, sap).font?.color?.argb).toBe("FF0000FF");
    const formula = (sheet.getCell(first, difference).value as ExcelJS.CellFormulaValue).formula;
    expect(formula).toBe(`${sheet.getColumn(sap).letter}${first}-${sheet.getColumn(efinance).letter}${first}`);
    expect(["Συμφωνεί", "Διαφορά", "Μόνο στο SAP", "Μόνο στο eFinance"]).toContain(sheet.getCell(first, status).value);

    let totals = 0;
    for (let r = first; r <= sheet.rowCount; r += 1) if (sheet.getCell(r, 1).value === "Σύνολο") totals = r;
    expect(totals).toBeGreaterThan(first);
    expect((sheet.getCell(totals, sap).value as ExcelJS.CellFormulaValue).formula).toMatch(/^SUM\(/);
    expect((sheet.getCell(totals, difference).value as ExcelJS.CellFormulaValue).formula).toMatch(/-/);
  });
});
