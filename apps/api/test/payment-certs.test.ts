/**
 * R11 — payment certificates, and R18 — the year-end accruals that read them.
 *
 * What it proves:
 *  - the number is per contract and nobody types it;
 *  - retention, the previously certified total and the net payable are the
 *    API's and never the caller's;
 *  - DRAFT → ENGINEER_APPROVED → FINANCE_RECEIVED → PAID, forward only, with
 *    the fields each step needs;
 *  - CAPEX-01 §10: the approver is never the creator, in the service and in
 *    the database (ADR-0015's precedent);
 *  - R31: a certificate over the contract value and retention released early
 *    both warn and neither blocks;
 *  - R18: what is certified and not invoiced, and the workbook that carries
 *    it with live formulas.
 */
import { Client } from "pg";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract } from "./contract-support";

describe("payment certificates (R11, R18, R31)", () => {
  let app: INestApplication;
  let db: Client;
  let contractId: string;
  let projectId: string;
  let orgUnitId: string;
  let certId: string;

  const get = (path: string) => request(app.getHttpServer()).get(path);
  const post = (path: string) => request(app.getHttpServer()).post(path);

  beforeAll(async () => {
    app = await createTestApp();
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await db.connect();
    const made = await makeContract(
      app,
      "cert",
      {
        originalValue: 1_000_000,
        retentionPct: 5,
        awardDate: "2026-01-10",
        startDate: "2026-02-01",
        completionDate: "2026-11-30",
        defectsLiabilityMonths: 12,
        sapPoNumber: "4500922001",
      },
      USERS.estatesNicosia,
    );
    contractId = made.contract.id;
    projectId = made.project.id;
    orgUnitId = made.project.orgUnitId;
  });

  afterAll(async () => {
    await db.end();
    await app.close();
  });

  it("derives the retention, the previous total and the net payable itself", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const created = await post(`/contracts/${contractId}/payment-certs`)
      .set(bearer(token))
      .send({
        periodFrom: "2026-02-01",
        periodTo: "2026-02-28",
        workDoneValue: 200_000,
        materialsOnSite: 20_000,
        // A caller who sends these is ignored: they are not in
        // PaymentCertCreate, and the API works them out.
        retentionHeld: 1,
        netPayable: 999,
      });
    expect(created.status).toBe(201);
    certId = created.body.id;
    expect(created.body.number).toBe(1);
    expect(created.body.status).toBe("DRAFT");
    expect(created.body.retentionHeld).toBe(11_000);
    expect(created.body.previousCertified).toBe(0);
    expect(created.body.netPayable).toBe(209_000);
    expect(created.body.createdByName).not.toBe("");
  });

  it("numbers the next one itself and takes the earlier gross off the top", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const second = await post(`/contracts/${contractId}/payment-certs`)
      .set(bearer(token))
      .send({
        periodFrom: "2026-03-01",
        periodTo: "2026-03-31",
        workDoneValue: 400_000,
        materialsOnSite: 10_000,
      });
    expect(second.status).toBe(201);
    expect(second.body.number).toBe(2);
    // workDoneValue is cumulative, so the first certificate's gross comes off.
    expect(second.body.previousCertified).toBe(220_000);
    expect(second.body.retentionHeld).toBe(20_500);
    expect(second.body.netPayable).toBe(169_500);

    const list = await get(`/contracts/${contractId}/payment-certs`).set(bearer(token));
    expect(list.body.map((cert: { number: number }) => cert.number)).toEqual([1, 2]);
  });

  it("refuses the creator's own approval, in the service and in the database", async () => {
    const creator = await tokenFor(app, USERS.estatesNicosia);
    const refused = await post(`/payment-certs/${certId}/transition`)
      .set(bearer(creator))
      .send({ to: "ENGINEER_APPROVED", sapInvoiceRef: null, paidDate: null });
    expect(refused.status).toBe(403);
    expect(refused.body.key).toBe("errors.sameUserApproval");

    // ADR-0015's third place: the CHECK holds for a console session too.
    await expect(
      db.query(
        "update ecapital.payment_cert set approved_by = created_by where id = $1",
        [certId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("moves forward one step at a time, with what each step needs", async () => {
    const admin = await tokenFor(app, USERS.admin);
    const finance = await tokenFor(app, USERS.finance);

    // Never two at once.
    const skipped = await post(`/payment-certs/${certId}/transition`)
      .set(bearer(finance))
      .send({ to: "FINANCE_RECEIVED", sapInvoiceRef: "5100000001", paidDate: null });
    expect(skipped.status).toBe(422);
    expect(skipped.body.key).toBe("errors.certTransitionNotAllowed");

    const approved = await post(`/payment-certs/${certId}/transition`)
      .set(bearer(admin))
      .send({ to: "ENGINEER_APPROVED", sapInvoiceRef: null, paidDate: null });
    expect(approved.status).toBe(200);
    expect(approved.body.approvedByName).not.toBe("");
    expect(approved.body.approvedAt).not.toBeNull();

    // Finance receives it, and not without the SAP reference.
    const noReference = await post(`/payment-certs/${certId}/transition`)
      .set(bearer(finance))
      .send({ to: "FINANCE_RECEIVED", sapInvoiceRef: null, paidDate: null });
    expect(noReference.status).toBe(422);
    expect(noReference.body.key).toBe("errors.sapInvoiceRefNeeded");

    // And not by the engineer who approved it.
    const wrongRole = await post(`/payment-certs/${certId}/transition`)
      .set(bearer(await tokenFor(app, USERS.estatesNicosia)))
      .send({ to: "FINANCE_RECEIVED", sapInvoiceRef: "5100000001", paidDate: null });
    expect(wrongRole.status).toBe(403);

    const received = await post(`/payment-certs/${certId}/transition`)
      .set(bearer(finance))
      .send({ to: "FINANCE_RECEIVED", sapInvoiceRef: "5100000001", paidDate: null });
    expect(received.status).toBe(200);
    expect(received.body.sapInvoiceRef).toBe("5100000001");

    const noDate = await post(`/payment-certs/${certId}/transition`)
      .set(bearer(finance))
      .send({ to: "PAID", sapInvoiceRef: null, paidDate: null });
    expect(noDate.status).toBe(422);
    expect(noDate.body.key).toBe("errors.paidDateNeeded");

    const paid = await post(`/payment-certs/${certId}/transition`)
      .set(bearer(finance))
      .send({ to: "PAID", sapInvoiceRef: null, paidDate: "2026-04-15" });
    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("PAID");
    expect(paid.body.paidDate).toBe("2026-04-15");
  });

  it("never goes back, whatever asks", async () => {
    const finance = await tokenFor(app, USERS.finance);
    const back = await post(`/payment-certs/${certId}/transition`)
      .set(bearer(finance))
      .send({ to: "DRAFT", sapInvoiceRef: null, paidDate: null });
    expect(back.status).toBe(422);

    await expect(
      db.query("update ecapital.payment_cert set status = 'DRAFT' where id = $1", [certId]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("warns when a certificate takes the contract past its value, and saves it anyway", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const over = await post(`/contracts/${contractId}/payment-certs`)
      .set(bearer(token))
      .send({
        periodFrom: "2026-04-01",
        periodTo: "2026-04-30",
        workDoneValue: 1_100_000,
        materialsOnSite: 0,
      });
    // RULE (CAPEX-01 §1): warn and flag. The certificate is written.
    expect(over.status).toBe(201);

    const finance = await tokenFor(app, USERS.finance);
    const cost = await get(`/projects/${projectId}/cost`).set(bearer(finance));
    const warning = cost.body.warnings.find(
      (row: { key: string }) => row.key === "certifiedOverContract",
    );
    expect(warning).toBeDefined();
    expect(warning.amount).toBe(100_000);
    expect(warning.contractId).toBe(contractId);
  });

  it("warns when retention is released before the defects liability ends", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const created = await post(`/contracts/${contractId}/payment-certs`)
      .set(bearer(token))
      .send({
        periodFrom: "2026-05-01",
        periodTo: "2026-05-31",
        workDoneValue: 1_100_000,
        materialsOnSite: 0,
      });
    const admin = await tokenFor(app, USERS.admin);
    const released = await post(`/payment-certs/${created.body.id}/transition`)
      .set(bearer(admin))
      .send({ to: "ENGINEER_APPROVED", sapInvoiceRef: null, paidDate: null, retentionReleased: true });
    expect(released.status).toBe(200);
    expect(released.body.retentionReleased).toBe(true);

    const finance = await tokenFor(app, USERS.finance);
    const cost = await get(`/projects/${projectId}/cost`).set(bearer(finance));
    const warning = cost.body.warnings.find(
      (row: { key: string }) => row.key === "retentionBeforeDlpEnd",
    );
    expect(warning).toBeDefined();
    expect(warning.sentenceEl).toContain("αρακράτηση");
  });

  it("proposes the accrual for what is certified and not invoiced", async () => {
    // R18: the second certificate is ENGINEER_APPROVED and unpaid, and the
    // contract has one actual posting against it in the year.
    await db.query(
      `insert into ecapital.cost_txn
         (org_unit_id, project_id, contract_id, txn_type, source, source_ref,
          doc_date, posting_date, amount, description, matched_by)
       values ($1, $2, $3, 'ACTUAL', 'SAP_EXTRACT', 'ACCRUAL-INV-1',
               '2026-06-01', '2026-06-30', 90000, 'Τιμολόγιο', 'PO')`,
      [orgUnitId, projectId, contractId],
    );

    const finance = await tokenFor(app, USERS.finance);
    const response = await get("/cost/accruals?year=2026").set(bearer(finance));
    expect(response.status).toBe(200);
    const mine = response.body.filter(
      (row: { contractId: string }) => row.contractId === contractId,
    );
    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) {
      expect(row.accrual).toBeCloseTo(row.certifiedNet - row.invoiced, 2);
      expect(row.invoiced).toBe(90_000);
      expect(row.asOf).toBe("2026-12-31");
    }

    const filtered = await get(`/cost/accruals?year=2026&orgUnitId=${orgUnitId}`).set(bearer(finance));
    expect(filtered.body.length).toBeGreaterThan(0);
    const elsewhere = await get("/cost/accruals?year=2026&orgUnitId=larnaca-general").set(
      bearer(finance),
    );
    expect(
      elsewhere.body.some((row: { contractId: string }) => row.contractId === contractId),
    ).toBe(false);
  });

  it("exports the accruals with the accrual and the totals as live formulas", async () => {
    const finance = await tokenFor(app, USERS.finance);
    const response = await get("/cost/accruals/export?year=2026")
      .set(bearer(finance))
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toContain("ecapital-accruals-2026.xlsx");

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const sheet = workbook.worksheets[0];
    // Greek in row 1, English in row 2 (CAPEX-01 §6.1).
    expect(sheet.getCell("H1").value).toBe("Δεδουλευμένα");
    expect(sheet.getCell("H2").value).toBe("Accrual");
    expect(sheet.getCell("F1").value).toBe("Καθαρό πληρωτέο");

    // The owner's requirement: live and auditable, never a pasted value.
    const accrual = sheet.getCell("H3").value as { formula?: string };
    expect(accrual.formula).toBe("F3-G3");
    expect(sheet.getCell("F3").numFmt).toBe("#,##0.00");

    let totalsRow = 0;
    sheet.eachRow((row, number) => {
      if (row.getCell(1).value === "Σύνολο") totalsRow = number;
    });
    expect(totalsRow).toBeGreaterThan(2);
    const total = sheet.getCell(`H${totalsRow}`).value as { formula?: string };
    expect(total.formula).toMatch(/^SUM\(H3:H\d+\)$/);
  });

  it("refuses a read-only account a certificate and a transition", async () => {
    const auditor = await tokenFor(app, USERS.auditor);
    const refused = await post(`/contracts/${contractId}/payment-certs`)
      .set(bearer(auditor))
      .send({ periodFrom: "2026-07-01", periodTo: "2026-07-31", workDoneValue: 1, materialsOnSite: 0 });
    expect(refused.status).toBe(403);
  });
});
