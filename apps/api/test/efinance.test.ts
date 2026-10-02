import type { INestApplication } from "@nestjs/common";
import {
  ContractBudgetPosition,
  ContractDetail,
  EFinanceContractStatus,
  EFinanceInvoiceList,
  EFinanceMasterSyncResult,
  EFinanceRequisitionList,
  EFinanceSyncResult,
  EFinanceVendorList,
  ProjectBudgetPosition,
  ProjectCost,
} from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EFinanceBudgetCodeReader } from "../src/budget-codes/source/efinance.reader";
import { AppError } from "../src/common/errors";
import { ContractPushService } from "../src/efinance/contract-push.service";
import { EFinanceClient, EFinanceError, toAmount } from "../src/efinance/efinance-client";
import { EFinanceReadService } from "../src/efinance/efinance-read.service";
import { USERS, bearer, createAppWith, createTestApp, tokenFor } from "./app";
import { contractBody, projectAt } from "./contract-support";
import { FAKE_TOKEN, FakeEFinance, bookedInvoice } from "./efinance-fake";

/**
 * ADR-0029 — the eFinance client, the contract push, the reads into the cost
 * ledger, the budget position and the master data, against a fake eFinance
 * that answers the integration record's routes on a loopback port.
 *
 * What these tests do not exercise is the real eFinance: the fake answers
 * the shapes the record spells out, and the first push and the first sync on
 * the server are things somebody watches (RUNBOOK §3).
 */

async function contractorWithVendor(app: INestApplication, name: string, vendor: string | null): Promise<string> {
  const token = await tokenFor(app, USERS.admin);
  const created = await request(app.getHttpServer())
    .post("/contractors")
    .set(bearer(token))
    .send({ name, vatNumber: null, registrationNo: null, category: "BUILDING", sapVendorId: vendor });
  if (created.status !== 201) throw new Error(`contractor: ${created.status} ${JSON.stringify(created.body)}`);
  return created.body.id as string;
}

async function contractFor(
  app: INestApplication,
  stamp: string,
  vendor: string | null,
  overrides: Record<string, unknown> = {},
): Promise<{ contract: ContractDetail; projectId: string; projectCode: string; contractorId: string }> {
  const project = await projectAt(app, "IN_PROGRESS", `Έργο eFinance ${stamp}`);
  const contractorId = await contractorWithVendor(app, `Ανάδοχος eFinance ${stamp}`, vendor);
  const token = await tokenFor(app, USERS.admin);
  const created = await request(app.getHttpServer())
    .post(`/projects/${project.id}/contracts`)
    .set(bearer(token))
    .send(contractBody(project.id, contractorId, `ΤΥ/ΕΦ/${stamp}`, overrides));
  if (created.status !== 201) throw new Error(`contract: ${created.status} ${JSON.stringify(created.body)}`);
  return { contract: ContractDetail.parse(created.body), projectId: project.id, projectCode: project.code, contractorId };
}

// ------------------------------------------------------------------ client --

describe("EFinanceClient", () => {
  const fake = new FakeEFinance();

  beforeAll(async () => {
    await fake.start();
  });
  afterAll(async () => {
    await fake.stop();
  });

  it("is not configured with no token, a blank one or the template's CHANGE-ME, and refuses to call", async () => {
    for (const token of [undefined, "", "   ", "CHANGE-ME"]) {
      const client = new EFinanceClient(token, { baseUrl: fake.url });
      expect(client.configured).toBe(false);
      await expect(client.entities()).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    }
    expect(new EFinanceClient(FAKE_TOKEN, { baseUrl: fake.url }).configured).toBe(true);
  });

  it("maps the error envelope to an AppError carrying eFinance's own code", async () => {
    const wrong = new EFinanceClient("a-different-test-token", { baseUrl: fake.url });
    const error = await wrong.entities().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EFinanceError);
    expect(error).toBeInstanceOf(AppError);
    const efinance = error as EFinanceError;
    expect(efinance.code).toBe("UNAUTHENTICATED");
    expect(efinance.upstreamStatus).toBe(401);
    expect(efinance.getStatus()).toBe(502);
    expect(efinance.messageKey).toBe("errors.efinanceFailed");
    expect(efinance.summary).toMatch(/^UNAUTHENTICATED: /);
  });

  it("builds every call from scratch: the bearer token and no forwarded-edge header", async () => {
    const client = new EFinanceClient(FAKE_TOKEN, { baseUrl: fake.url });
    await client.entities();
    const call = fake.calls[fake.calls.length - 1];
    expect(call.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    for (const header of ["x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip", "cf-ray"]) {
      expect(call.headers[header]).toBeUndefined();
    }
  });

  it("gives up after its timeout and says so", async () => {
    const client = new EFinanceClient(FAKE_TOKEN, { baseUrl: fake.url, readTimeoutMs: 100 });
    fake.delayMs = 400;
    try {
      await expect(client.entities()).rejects.toMatchObject({ code: "TIMEOUT" });
    } finally {
      fake.delayMs = 0;
    }
  });

  it("refuses a connection nobody answers as NETWORK, not as eFinance's answer", async () => {
    const client = new EFinanceClient(FAKE_TOKEN, { baseUrl: "http://127.0.0.1:1" });
    await expect(client.entities()).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("follows next_cursor to the end of a paged list", async () => {
    const client = new EFinanceClient(FAKE_TOKEN, { baseUrl: fake.url });
    fake.pageSize = 2;
    try {
      const vendors = await client.vendors();
      expect(vendors.map((vendor) => vendor.vendor_code)).toEqual(["100123", "100124", "100125", "100126", "100127"]);
      const first = await client.vendorsPage(null, 2);
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBe("2");
    } finally {
      fake.pageSize = 200;
    }
  });

  it("keeps money as 2-decimal strings and an unknown amount as null; numbers only at the edge", async () => {
    const client = new EFinanceClient(FAKE_TOKEN, { baseUrl: fake.url });
    fake.positions.push({
      budget_code: "7501",
      entity_code: "NGH",
      archive_code: "NGH",
      year: 2026,
      allocated: "500000.00",
      booked: null,
      in_flight: "0.00",
      requisitions: "1250.50",
      available: null,
    });
    const answer = await client.budgetPosition({ year: 2026, entity: "NGH", code: "7501" });
    expect(answer.items[0].allocated).toBe("500000.00");
    expect(answer.items[0].booked).toBeNull();
    expect(toAmount(answer.items[0].requisitions)).toBe(1250.5);
    expect(toAmount(answer.items[0].booked)).toBeNull();
    expect(toAmount(answer.items[0].in_flight)).toBe(0);
    fake.positions.pop();
  });

  it("feeds the budget-code reader: name before description, category kept, inactive left out", async () => {
    const reader = new EFinanceBudgetCodeReader(new EFinanceClient(FAKE_TOKEN, { baseUrl: fake.url }));
    const rows = await reader.read();
    expect(rows).toEqual([
      { code: "7402", descriptionEl: "MEDICAL & OTHER EQUI", descriptionEn: "MEDICAL & OTHER EQUI", category: "Εξοπλισμός", isCapex: true },
      { code: "7501", descriptionEl: "Μηχανήματα και εξοπλισμός", descriptionEn: "Μηχανήματα και εξοπλισμός", category: "Εξοπλισμός", isCapex: true },
    ]);
    expect(fake.calls[fake.calls.length - 1].query.kind).toBe("capex");

    const refused = new EFinanceBudgetCodeReader(new EFinanceClient("a-different-test-token", { baseUrl: fake.url }));
    await expect(refused.read()).rejects.toMatchObject({ messageKey: "errors.budgetCodeSyncFailed" });
  });
});

// ------------------------------------------------- configured, end to end --

describe("eFinance, configured (ADR-0029)", () => {
  const fake = new FakeEFinance();
  let app: INestApplication;
  let db: Client;
  let admin: string;

  beforeAll(async () => {
    await fake.start();
    app = await createAppWith({ EFINANCE_TOKEN: FAKE_TOKEN, EFINANCE_API_URL: fake.url, EFINANCE_PUSH_ENABLED: "1" });
    admin = await tokenFor(app, USERS.admin);
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await db.connect();
  });
  afterAll(async () => {
    // The timer's pass pushes every pushable contract in the shared test
    // database, the seeded ones included. Put them back as the other suites
    // expect to find them: never pushed, so the SAP extract's actuals on them
    // still count (ADR-0029 §3), and no eFinance rows in anybody's ledger.
    await db.query("delete from ecapital.cost_txn where source = 'EFINANCE'");
    await db.query(
      "update ecapital.contract set efinance_pushed_at = null, efinance_last_error = null, efinance_spend = null where efinance_pushed_at is not null or efinance_last_error is not null or efinance_spend is not null",
    );
    await db.end();
    await app.close();
    await fake.stop();
  });

  async function efinanceTxnCount(contractId: string): Promise<number> {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from ecapital.cost_txn where source = 'EFINANCE' and contract_id = $1",
      [contractId],
    );
    return rows[0].n;
  }

  async function sync(): Promise<EFinanceSyncResult> {
    const response = await request(app.getHttpServer()).post("/admin/efinance/sync").set(bearer(admin));
    expect(response.status).toBe(200);
    return EFinanceSyncResult.parse(response.body);
  }

  it("pushes a new contract first, with the body the record asks for", async () => {
    const stamp = `push-${Date.now()}`;
    const { contract, projectCode } = await contractFor(app, stamp, "100123");

    const put = fake.puts.find((p) => p.capRef === contract.ref);
    expect(put).toBeDefined();
    expect(put!.body).toEqual({
      project_ref: projectCode,
      title: `Έργο eFinance ${stamp}`,
      entity_code: "NGH",
      budget_code: "7402",
      vendor_code: "100123",
      current_value: "500000.00",
      status: "active",
      updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/),
    });

    const status = await request(app.getHttpServer()).get(`/contracts/${contract.id}/efinance`).set(bearer(admin));
    expect(status.status).toBe(200);
    const parsed = EFinanceContractStatus.parse(status.body);
    expect(parsed.configured).toBe(true);
    expect(parsed.capRef).toBe(contract.ref);
    expect(parsed.pushedAt).not.toBeNull();
    expect(parsed.lastError).toBeNull();
    expect(parsed.booked).toBe(0);
    expect(parsed.remaining).toBe(500000);

    expect(contract.efinance?.pushedAt).not.toBeNull();
    expect(contract.warnings.map((w) => w.key)).not.toContain("efinanceNotPushable");
  });

  it("pushes the new value when a variation is approved, and closed when the project closes", async () => {
    const stamp = `var-${Date.now()}`;
    const { contract, projectId } = await contractFor(app, stamp, "100124");
    const estates = await tokenFor(app, USERS.estatesNicosia);

    const raised = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations`)
      .set(bearer(admin))
      .send({ descriptionEl: "Πρόσθετες εργασίες", reason: "CLIENT_CHANGE", value: 25000, timeImpactDays: 0 });
    expect(raised.status).toBe(201);
    const vid = raised.body.id as string;
    expect((await request(app.getHttpServer()).post(`/contracts/${contract.id}/variations/${vid}/submit`).set(bearer(admin))).status).toBe(200);
    const decided = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations/${vid}/decide`)
      .set(bearer(estates))
      .send({ decision: "APPROVED", commentEl: null });
    expect(decided.status).toBe(200);

    const puts = fake.puts.filter((p) => p.capRef === contract.ref);
    expect(puts[puts.length - 1].body.current_value).toBe("525000.00");

    for (const phase of ["PRACTICAL_COMPLETION", "DEFECTS_LIABILITY", "CLOSED"]) {
      const moved = await request(app.getHttpServer())
        .post(`/projects/${projectId}/phase`)
        .set(bearer(admin))
        .send({ phase, reasonEl: "Δοκιμαστική μετάβαση σταδίου" });
      expect(moved.status).toBe(200);
    }
    const last = fake.puts.filter((p) => p.capRef === contract.ref).pop();
    expect(last?.body.status).toBe("closed");
  });

  it("does not push a contract it cannot build, and says which field is missing", async () => {
    const stamp = `nopush-${Date.now()}`;
    const { contract } = await contractFor(app, stamp, null);
    expect(fake.puts.some((p) => p.capRef === contract.ref)).toBe(false);

    const warning = contract.warnings.find((w) => w.key === "efinanceNotPushable");
    expect(warning).toBeDefined();
    expect(warning!.sentenceEl).toContain("κωδικό προμηθευτή SAP");
    expect(warning!.sentenceEn).toContain("contractor SAP vendor code");
    expect(warning!.sentenceEl).not.toContain("κωδικό προϋπολογισμού");

    const manual = await request(app.getHttpServer()).post(`/contracts/${contract.id}/efinance/push`).set(bearer(admin));
    expect(manual.status).toBe(422);
    expect(manual.body.key).toBe("errors.efinanceMissingVendorCode");

    // Both missing: one sentence names both.
    const both = await contractFor(app, `${stamp}-b`, null, { budgetCode: null });
    const sentence = both.contract.warnings.find((w) => w.key === "efinanceNotPushable")!;
    expect(sentence.sentenceEl).toContain("κωδικό προϋπολογισμού ούτε κωδικό προμηθευτή SAP");
    expect(sentence.sentenceEn).toContain("no budget code and no contractor SAP vendor code");
  });

  it("stores a 409 as the error, raises efinanceConflict, and leaves it for a person — not the timer", async () => {
    const stamp = `conflict-${Date.now()}`;
    const { contract } = await contractFor(app, stamp, "100125");
    // Somebody already has this reference under another hospital in eFinance.
    fake.contracts.set(contract.ref, { ...fake.contracts.get(contract.ref)!, entity_code: "LAR" });

    const changed = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(admin))
      .send({ extensionDays: 10 });
    expect(changed.status).toBe(200);
    const detail = ContractDetail.parse(changed.body);
    expect(detail.efinance?.lastError).toMatch(/^CONFLICT: /);
    const warning = detail.warnings.find((w) => w.key === "efinanceConflict");
    expect(warning).toBeDefined();
    expect(warning!.sentenceEl).toContain("Το eFinance δεν δέχτηκε τη σύμβαση");
    expect(warning!.sentenceEn).toContain("already exists there");

    const before = fake.calls.filter((c) => c.method === "PUT" && c.path.endsWith(contract.ref)).length;
    await app.get(ContractPushService).retryPending(1000);
    const after = fake.calls.filter((c) => c.method === "PUT" && c.path.endsWith(contract.ref)).length;
    expect(after).toBe(before);

    // A person puts it right on eFinance's side and pushes by hand.
    fake.contracts.set(contract.ref, { ...fake.contracts.get(contract.ref)!, entity_code: "NGH" });
    const manual = await request(app.getHttpServer()).post(`/contracts/${contract.id}/efinance/push`).set(bearer(admin));
    expect(manual.status).toBe(200);
    expect(EFinanceContractStatus.parse(manual.body).lastError).toBeNull();
    const cleared = await request(app.getHttpServer()).get(`/contracts/${contract.id}`).set(bearer(admin));
    expect(cleared.body.warnings.map((w: { key: string }) => w.key)).not.toContain("efinanceConflict");
  });

  it("retries a push that failed because eFinance was away", async () => {
    const stamp = `retry-${Date.now()}`;
    fake.outage = true;
    let contract: ContractDetail;
    try {
      // The contract is recorded whatever eFinance answers; the failure is on it.
      ({ contract } = await contractFor(app, stamp, "100126"));
    } finally {
      fake.outage = false;
    }
    expect(contract.efinance?.lastError).toMatch(/^HTTP_503/);
    expect(contract.efinance?.pushedAt).toBeNull();

    const outcome = await app.get(ContractPushService).retryPending(1000);
    expect(outcome.pushed).toBeGreaterThanOrEqual(1);
    const status = await request(app.getHttpServer()).get(`/contracts/${contract.id}/efinance`).set(bearer(admin));
    expect(status.body.lastError).toBeNull();
    expect(status.body.pushedAt).not.toBeNull();

    // Nothing is left pending: a second pass has nothing to do for it.
    const before = fake.puts.filter((p) => p.capRef === contract.ref).length;
    await app.get(ContractPushService).retryPending(1000);
    expect(fake.puts.filter((p) => p.capRef === contract.ref).length).toBe(before);
  });

  describe("reads into the cost ledger", () => {
    let contract: ContractDetail;
    let projectId: string;

    beforeAll(async () => {
      const made = await contractFor(app, `sync-${Date.now()}`, "100123");
      contract = made.contract;
      projectId = made.projectId;
      fake.invoices.push(
        bookedInvoice(9001, contract.ref, "2026-09-16T09:00:00+00:00"),
        {
          ...bookedInvoice(9002, contract.ref, "2026-09-17T09:00:00+00:00"),
          ledger: "in_flight",
          sap_batch_date: null,
          lines: [{ ...bookedInvoice(0, "", "").lines[0], line_total: "7000.00", unit_price: "7000.00" }],
        },
        { ...bookedInvoice(9003, contract.ref, "2026-09-18T09:00:00+00:00"), ledger: "rejected" },
      );
      fake.requisitions.push({
        id: 501,
        number: "R-NGH-7402-150926-01",
        description: "Υλικά σκυροδέτησης",
        justification: "Πρόοδος εργασιών",
        entity_code: "NGH",
        cost_centre: "NGH100",
        budget_code: "7402",
        gl_account: "7402000",
        amount: "12000.00",
        currency: "EUR",
        status: "approved",
        cap_ref: contract.ref,
        po_number: null,
        created_at: "2026-09-15T08:00:00+00:00",
        updated_at: "2026-09-15T08:00:00+00:00",
      });
    });

    it("posts one ACTUAL per booked line, and running it again changes nothing", async () => {
      const first = await sync();
      expect(first.configured).toBe(true);
      expect(first.invoices.error).toBeNull();
      expect(first.invoices.rows).toBeGreaterThanOrEqual(3);
      expect(first.invoices.cursor).not.toBeNull();
      expect(await efinanceTxnCount(contract.id)).toBe(2);

      const { rows } = await db.query(
        `select source_ref, amount::text, posting_date::text, doc_date::text, matched_by::text, sap_wbs, cost_centre, gl_account, vendor_name, txn_type::text
           from ecapital.cost_txn where source = 'EFINANCE' and contract_id = $1 order by source_ref`,
        [contract.id],
      );
      expect(rows).toEqual([
        {
          source_ref: "efinance:invoice:9001:0",
          amount: "20000.00",
          posting_date: "2026-09-15",
          doc_date: "2026-08-20",
          matched_by: "RULE",
          sap_wbs: "NGH-2026-001.01",
          cost_centre: "NGH100",
          gl_account: "7402000",
          vendor_name: "ΚΑΤΑΣΚΕΥΑΣΤΙΚΗ ΑΛΦΑ ΛΤΔ",
          txn_type: "ACTUAL",
        },
        expect.objectContaining({ source_ref: "efinance:invoice:9001:1", amount: "10000.00", sap_wbs: null }),
      ]);

      const second = await sync();
      expect(second.invoices.rows).toBe(0);
      expect(second.requisitions.rows).toBe(0);
      expect(await efinanceTxnCount(contract.id)).toBe(2);
    });

    it("never counts in flight as spent, and shows it and the requisitions beside the ledgers", async () => {
      const cost = await request(app.getHttpServer()).get(`/projects/${projectId}/cost`).set(bearer(admin));
      expect(cost.status).toBe(200);
      const parsed = ProjectCost.parse(cost.body);
      expect(parsed.ledgers.spent).toBe(30000);
      // Requisitions are eFinance's commitment, never eCapital's.
      expect(parsed.ledgers.committed).toBe(500000);
      expect(parsed.efinance?.booked).toBe(30000);
      expect(parsed.efinance?.inFlight).toBe(7000);
      expect(parsed.efinance?.requisitions).toBe(12000);
      expect(parsed.efinance?.remaining).toBe(458000);

      const detail = await request(app.getHttpServer()).get(`/contracts/${contract.id}`).set(bearer(admin));
      expect(detail.body.efinance.inFlight).toBe(7000);

      const { rows } = await db.query(
        "select count(*)::int as n from ecapital.cost_txn where source_ref like 'efinance:invoice:9002:%' or source_ref like 'efinance:invoice:9003:%'",
      );
      expect(rows[0].n).toBe(0);

      const reqs = await request(app.getHttpServer()).get(`/contracts/${contract.id}/efinance/requisitions`).set(bearer(admin));
      const list = EFinanceRequisitionList.parse(reqs.body);
      expect(list.items.map((r) => [r.number, r.amount])).toEqual([["R-NGH-7402-150926-01", 12000]]);
    });

    it("counts eFinance's lines, not the SAP extract's, as spent on a contract eFinance holds", async () => {
      const { rows } = await db.query<{ id: string }>(
        `insert into ecapital.cost_txn (org_unit_id, project_id, contract_id, txn_type, source, source_ref, posting_date, amount, matched_by)
         values ('nicosia-general', $1, $2, 'ACTUAL', 'SAP_EXTRACT', 'KSB1:test:${Date.now()}', '2026-09-15', 30000, 'PO')
         returning id`,
        [projectId, contract.id],
      );
      try {
        const cost = ProjectCost.parse(
          (await request(app.getHttpServer()).get(`/projects/${projectId}/cost`).set(bearer(admin))).body,
        );
        // The same invoice, once from eFinance and once from the extract: counted once.
        expect(cost.ledgers.spent).toBe(30000);
      } finally {
        await db.query("delete from ecapital.cost_txn where id = $1", [rows[0].id]);
      }
    });

    it("takes a reversed invoice out of spend and keeps it in the history with its reason", async () => {
      const original = fake.invoices.find((invoice) => invoice.id === 9001)!;
      Object.assign(original, {
        ledger: "reversed",
        reversed_at: "2026-09-25T10:00:00+00:00",
        reversal_sap_doc_no: "5100009999",
        reversal_reason: "Λάθος ποσό στο τιμολόγιο",
        updated_at: "2026-09-25T10:00:00+00:00",
      });
      const result = await sync();
      expect(result.invoices.rows).toBe(1);
      expect(await efinanceTxnCount(contract.id)).toBe(0);

      const cost = ProjectCost.parse(
        (await request(app.getHttpServer()).get(`/projects/${projectId}/cost`).set(bearer(admin))).body,
      );
      expect(cost.ledgers.spent).toBeNull();

      const invoices = EFinanceInvoiceList.parse(
        (await request(app.getHttpServer()).get(`/contracts/${contract.id}/efinance/invoices`).set(bearer(admin))).body,
      );
      const reversed = invoices.items.find((invoice) => invoice.id === "9001")!;
      expect(reversed.ledger).toBe("reversed");
      expect(reversed.reversalReason).toBe("Λάθος ποσό στο τιμολόγιο");
      expect(reversed.reversalSapDocNo).toBe("5100009999");
      expect(reversed.lines).toHaveLength(2);
      expect(reversed.lines[0].lineTotal).toBe(20000);
      expect(invoices.items.map((invoice) => invoice.ledger).sort()).toEqual(["in_flight", "rejected", "reversed"]);
    });

    it("polls with updated_since and follows next_cursor across pages", async () => {
      fake.pageSize = 1;
      try {
        fake.invoices.push(
          bookedInvoice(9004, contract.ref, "2026-09-26T10:00:00+00:00"),
          bookedInvoice(9005, contract.ref, "2026-09-27T10:00:00+00:00"),
        );
        const before = fake.calls.length;
        const result = await sync();
        expect(result.invoices.rows).toBe(2);
        expect(result.invoices.cursor).toBe("2026-09-27T10:00:00+00:00");
        const polls = fake.calls.slice(before).filter((call) => call.path === "/api/v1/capital/invoices");
        expect(polls.length).toBeGreaterThanOrEqual(2);
        expect(polls[0].query.updated_since).toBe("2026-09-25T10:00:00+00:00");
        expect(polls[1].query.cursor).toBe("1");
        expect(await efinanceTxnCount(contract.id)).toBe(4);
      } finally {
        fake.pageSize = 200;
      }
    });
  });

  it("maps the budget position, never counting in flight as committed, and caches it for a minute", async () => {
    app.get(EFinanceReadService).clearCache();
    const { contract, projectId } = await contractFor(app, `pos-${Date.now()}`, "100123");
    const before = fake.callsTo("/api/v1/budget/position");

    const response = await request(app.getHttpServer())
      .get(`/contracts/${contract.id}/budget-position`)
      .set(bearer(admin));
    expect(response.status).toBe(200);
    const parsed = ContractBudgetPosition.parse(response.body);
    expect(parsed).toEqual({
      configured: true,
      position: {
        budgetCode: "7402",
        entityCode: "NGH",
        year: 2026,
        allocated: 1000000,
        booked: 250000,
        requisitions: 100000,
        inFlight: 40000,
        available: 650000,
        asOf: "2026-10-02T08:00:00+00:00",
      },
    });
    const call = fake.calls.filter((c) => c.path === "/api/v1/budget/position").pop()!;
    expect(call.query).toMatchObject({ year: "2026", entity: "NGH", code: "7402" });

    await request(app.getHttpServer()).get(`/contracts/${contract.id}/budget-position`).set(bearer(admin));
    const project = await request(app.getHttpServer()).get(`/projects/${projectId}/budget-position`).set(bearer(admin));
    expect(ProjectBudgetPosition.parse(project.body).items).toHaveLength(1);
    expect(fake.callsTo("/api/v1/budget/position")).toBe(before + 1);

    const bad = await request(app.getHttpServer()).get(`/contracts/${contract.id}/budget-position?year=26`).set(bearer(admin));
    expect(bad.status).toBe(400);
    expect(bad.body.key).toBe("errors.efinanceYearNotValid");
  });

  it("fills the unit codes and the vendor list, and searches vendors locally", async () => {
    await db.query("update ecapital.org_unit set efinance_code = null where code = 'PAF'");
    fake.pageSize = 2;
    let result: EFinanceMasterSyncResult;
    try {
      const response = await request(app.getHttpServer()).post("/admin/efinance/sync-master").set(bearer(admin));
      expect(response.status).toBe(200);
      result = EFinanceMasterSyncResult.parse(response.body);
    } finally {
      fake.pageSize = 200;
    }
    expect(result.error).toBeNull();
    expect(result.unitsMatched).toBe(2);
    expect(result.vendorsUpserted).toBe(5);
    const { rows } = await db.query("select efinance_code from ecapital.org_unit where code = 'PAF'");
    expect(rows[0].efinance_code).toBe("PAP");

    const engineer = await tokenFor(app, USERS.engineerLarnaca);
    const byName = await request(app.getHttpServer()).get("/efinance/vendors?q=βητα").set(bearer(engineer));
    expect(byName.status).toBe(200);
    expect(EFinanceVendorList.parse(byName.body).items.map((v) => v.vendorCode)).toEqual(["100124"]);
    const byCode = await request(app.getHttpServer()).get("/efinance/vendors?q=10012").set(bearer(engineer));
    expect(byCode.body.items).toHaveLength(5);
    expect(byCode.body.items[byCode.body.items.length - 1].active).toBe(false);
  });

  it("keeps the manual routes to the administrator", async () => {
    const finance = await tokenFor(app, USERS.finance);
    expect((await request(app.getHttpServer()).post("/admin/efinance/sync").set(bearer(finance))).status).toBe(403);
    expect((await request(app.getHttpServer()).post("/admin/efinance/sync-master").set(bearer(finance))).status).toBe(403);
  });
});

// --------------------------------------------------------- not configured --

describe("eFinance, token placed but EFINANCE_PUSH_ENABLED off (ADR-0029 addendum)", () => {
  const fake = new FakeEFinance();
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    await fake.start();
    app = await createAppWith({ EFINANCE_TOKEN: FAKE_TOKEN, EFINANCE_API_URL: fake.url });
    admin = await tokenFor(app, USERS.admin);
  });
  afterAll(async () => {
    await app.close();
    await fake.stop();
  });

  it("reads, but never sends a contract, and says why on a manual push", async () => {
    const stamp = `off-push-${Date.now()}`;
    const { contract } = await contractFor(app, stamp, null);
    const push = app.get(ContractPushService);
    expect(push.configured).toBe(false);
    expect(push.pushDisabled).toBe(true);
    expect(await push.retryPending()).toEqual({ tried: 0, pushed: 0 });
    expect(fake.puts.length).toBe(0);

    const manual = await request(app.getHttpServer()).post(`/contracts/${contract.id}/efinance/push`).set(bearer(admin));
    expect(manual.status).toBe(409);
    expect(manual.body.message ?? manual.body.error ?? JSON.stringify(manual.body)).toMatch(/eFinance/);

    const codes = await request(app.getHttpServer()).get("/budget-codes?kind=capex").set(bearer(admin));
    expect(codes.status).toBe(200);
  });
});

describe("eFinance, not configured", () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await tokenFor(app, USERS.admin);
  });
  afterAll(async () => {
    await app.close();
  });

  it("degrades everywhere to «not configured» without throwing", async () => {
    const stamp = `off-${Date.now()}`;
    const { contract, projectId } = await contractFor(app, stamp, null);
    expect(contract.efinance).toBeNull();
    expect(contract.warnings.map((w) => w.key)).not.toContain("efinanceNotPushable");

    const status = await request(app.getHttpServer()).get(`/contracts/${contract.id}/efinance`).set(bearer(admin));
    expect(status.status).toBe(200);
    expect(EFinanceContractStatus.parse(status.body)).toMatchObject({ configured: false, pushedAt: null, lastError: null, booked: null });

    const position = await request(app.getHttpServer()).get(`/contracts/${contract.id}/budget-position`).set(bearer(admin));
    expect(position.body).toEqual({ configured: false, position: null });
    const projectPosition = await request(app.getHttpServer()).get(`/projects/${projectId}/budget-position`).set(bearer(admin));
    expect(projectPosition.body).toEqual({ configured: false, items: [] });

    const synced = await request(app.getHttpServer()).post("/admin/efinance/sync").set(bearer(admin));
    expect(synced.status).toBe(200);
    expect(EFinanceSyncResult.parse(synced.body).configured).toBe(false);
    const master = await request(app.getHttpServer()).post("/admin/efinance/sync-master").set(bearer(admin));
    expect(EFinanceMasterSyncResult.parse(master.body).configured).toBe(false);

    const invoices = await request(app.getHttpServer()).get(`/contracts/${contract.id}/efinance/invoices`).set(bearer(admin));
    expect(invoices.body).toEqual({ configured: false, items: [], total: 0 });

    const cost = await request(app.getHttpServer()).get(`/projects/${projectId}/cost`).set(bearer(admin));
    expect(ProjectCost.parse(cost.body).efinance).toBeNull();

    expect(await app.get(ContractPushService).retryPending()).toEqual({ tried: 0, pushed: 0 });
  });
});
