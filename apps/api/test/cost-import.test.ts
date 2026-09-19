/**
 * R14, R15 — the SAP import and the unmatched-allocation queue, end to end
 * against a real PostgreSQL (ADR-0012).
 *
 * What it proves:
 *  - the three synthetic extracts in test/fixtures/sap read, with the Greek
 *    number and date formats and the sign conventions each report posts with;
 *  - a dry run writes nothing and answers the same summary;
 *  - the same file twice is refused, and a dry run of it is not;
 *  - a row finds its project by WBS, then by purchase order, then by cost
 *    centre, then by a remembered rule, in that order;
 *  - the queue suggests, the allocation remembers, the skip moves on and the
 *    commit closes;
 *  - the M2 definition of done: under 5% unmatched after the queue has been
 *    worked (CAPEX-01 §14);
 *  - and who may do each of those (CAPEX-01 §10).
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract, projectAt } from "./contract-support";
import { FIXTURE_KEYS, sapFixturePath } from "./fixtures/build-sap-fixtures";
import { SapMcpReader } from "../src/cost/source/sap-mcp.reader";
import { normalise, ruleText } from "../src/cost/text";

const ME2N = sapFixturePath("me2n.xlsx");
const KSB1 = sapFixturePath("ksb1.xlsx");
const FBL1N = sapFixturePath("fbl1n.xlsx");

describe("SAP import (R14, R15)", () => {
  let app: INestApplication;
  let db: Client;
  let projectA: string;
  let projectB: string;
  let projectC: string;

  const post = (path: string) => request(app.getHttpServer()).post(path);
  const get = (path: string) => request(app.getHttpServer()).get(path);

  async function upload(
    file: string,
    fields: { report: string; period: string; dryRun?: boolean },
    email: string = USERS.finance,
  ) {
    const token = await tokenFor(app, email);
    const call = post("/cost/imports")
      .set(bearer(token))
      .field("report", fields.report)
      .field("period", fields.period);
    if (fields.dryRun !== undefined) call.field("dryRun", String(fields.dryRun));
    return call.attach("file", readFileSync(file), file.split("/").pop() as string);
  }

  beforeAll(async () => {
    app = await createTestApp();
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await db.connect();

    // The register the fixture expects. The WBS element and the cost centre
    // are columns no API route writes — they arrive from SAP and from finance
    // — so the test arranges them the way the migration and the seed do.
    const a = await projectAt(app, "IN_PROGRESS", "Έργο αντιστοίχισης WBS", USERS.admin);
    const b = await projectAt(app, "IN_PROGRESS", "Έργο αντιστοίχισης εντολής αγοράς", USERS.admin);
    const c = await projectAt(app, "IN_PROGRESS", "Έργο αντιστοίχισης κέντρου κόστους", USERS.admin);
    projectA = a.id;
    projectB = b.id;
    projectC = c.id;

    await db.query("update ecapital.project set sap_wbs = $2 where id = $1", [projectA, FIXTURE_KEYS.wbsA]);
    await db.query("update ecapital.project set sap_wbs = $2 where id = $1", [projectB, FIXTURE_KEYS.wbsB]);
    await db.query("update ecapital.project set cost_centre = $2 where id = $1", [projectC, FIXTURE_KEYS.costCentre]);

    const made = await makeContract(app, "sap-po", {
      sapPoNumber: FIXTURE_KEYS.purchaseOrder,
      originalValue: 400_000,
    });
    // The purchase-order match hangs the row on the contract's own project,
    // which is the one the contract was recorded against.
    await db.query("update ecapital.project set sap_wbs = null where id = $1", [made.project.id]);
  });

  afterAll(async () => {
    await db.end();
    await app.close();
  });

  it("reads the extract without writing anything, which is the default", async () => {
    const response = await upload(ME2N, { report: "ME2N", period: "2026-01", dryRun: true });
    expect(response.status).toBe(201);
    const batch = response.body;

    expect(batch.status).toBe("DRY_RUN");
    expect(batch.id).toMatch(/^dry-run:/);
    expect(batch.report).toBe("ME2N");
    expect(batch.rowsIn).toBe(12);
    // «περίπου 3.000» is refused, never read as three thousand or as zero.
    expect(batch.rowsRejected).toBe(1);
    expect(batch.rowsMatched).toBe(8);
    expect(batch.rowsUnmatched).toBe(3);
    expect(batch.amountIn).toBeCloseTo(440_800.75, 2);
    expect(batch.exceptions.some((e: { rule: string }) => e.rule === "AMOUNT_UNREADABLE")).toBe(true);
    expect(batch.exceptions.some((e: { rule: string }) => e.rule === "UNMATCHED")).toBe(true);

    const { rows } = await db.query("select count(*)::int as n from ecapital.import_batch where period = '2026-01'");
    expect(rows[0].n).toBe(0);
  });

  it("writes the batch and the postings, and says how each row found its project", async () => {
    const response = await upload(ME2N, { report: "ME2N", period: "2026-01", dryRun: false });
    expect(response.status).toBe(201);
    const batch = response.body;
    expect(batch.status).toBe("PENDING_ALLOCATION");
    expect(batch.rowsMatched).toBe(8);

    const { rows } = await db.query<{ matched_by: string; n: number }>(
      "select matched_by, count(*)::int as n from ecapital.cost_txn where import_batch_id = $1 group by matched_by order by matched_by",
      [batch.id],
    );
    const byReason = new Map(rows.map((row) => [row.matched_by, row.n]));
    // Four WBS rows plus the repeated document, two on the purchase order,
    // one on the cost centre, three on nothing.
    expect(byReason.get("WBS")).toBe(5);
    expect(byReason.get("PO")).toBe(2);
    expect(byReason.get("COST_CENTRE")).toBe(1);
    expect(byReason.get("NONE")).toBe(3);

    // A sub-element of a WBS belongs to the project that holds the trunk.
    const { rows: sub } = await db.query<{ project_id: string }>(
      "select project_id from ecapital.cost_txn where import_batch_id = $1 and sap_wbs = $2",
      [batch.id, `${FIXTURE_KEYS.wbsA}.2`],
    );
    expect(sub[0].project_id).toBe(projectA);

    // The credit stays negative, because a credit is negative (CAPEX-01 §12).
    const { rows: credit } = await db.query<{ amount: string }>(
      "select amount from ecapital.cost_txn where import_batch_id = $1 and description = 'Πιστωτικό σημείωμα'",
      [batch.id],
    );
    expect(Number(credit[0].amount)).toBe(-2400);

    // ME2N is the commitment ledger.
    const { rows: types } = await db.query<{ txn_type: string }>(
      "select distinct txn_type from ecapital.cost_txn where import_batch_id = $1",
      [batch.id],
    );
    expect(types.map((row) => row.txn_type)).toEqual(["COMMITMENT"]);
  });

  it("refuses the same file twice, and lets a dry run of it through", async () => {
    const again = await upload(ME2N, { report: "ME2N", period: "2026-01", dryRun: false });
    expect(again.status).toBe(409);
    expect(again.body.key).toBe("errors.costImportDuplicate");

    const dry = await upload(ME2N, { report: "ME2N", period: "2026-01", dryRun: true });
    expect(dry.status).toBe(201);
  });

  it("offers up to nine suggestions a row, best evidence first", async () => {
    const token = await tokenFor(app, USERS.finance);
    const list = await get("/cost/imports").set(bearer(token));
    const batch = list.body.items.find((item: { period: string }) => item.period === "2026-01");

    const queue = await get(`/cost/imports/${batch.id}/unmatched`).set(bearer(token));
    expect(queue.status).toBe(200);
    expect(queue.body.remaining).toBe(3);
    expect(queue.body.items).toHaveLength(3);

    for (const row of queue.body.items) {
      expect(row.suggestions.length).toBeLessThanOrEqual(9);
      const ranks = row.suggestions.map((s: { confidence: string }) =>
        ["HIGH", "MEDIUM", "LOW"].indexOf(s.confidence),
      );
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }
  });

  it("allocates, remembers, skips and closes the batch", async () => {
    const token = await tokenFor(app, USERS.finance);
    const list = await get("/cost/imports").set(bearer(token));
    const batchId = list.body.items.find((item: { period: string }) => item.period === "2026-01").id;

    const queue = await get(`/cost/imports/${batchId}/unmatched`).set(bearer(token));
    const [first, second, third] = queue.body.items;

    // One skipped first, so the queue is seen to move on.
    const skipped = await post(`/cost/imports/${batchId}/skip`)
      .set(bearer(token))
      .send({ txnIds: [third.txn.id] });
    expect(skipped.status).toBe(200);
    expect(skipped.body.remaining).toBe(2);
    expect(skipped.body.next.txn.id).not.toBe(third.txn.id);

    const allocated = await post(`/cost/imports/${batchId}/allocate`)
      .set(bearer(token))
      .send({ txnIds: [first.txn.id, second.txn.id], projectId: projectA, contractId: null, remember: true });
    expect(allocated.status).toBe(200);
    // The two placed rows are gone from the queue; the skipped one is still
    // in the batch and still unmatched, it is only no longer offered.
    expect(allocated.body.remaining).toBe(0);
    expect(allocated.body.next).toBeNull();

    const { rows } = await db.query<{ matched_by: string }>(
      "select matched_by from ecapital.cost_txn where id = $1",
      [first.txn.id],
    );
    // RULE (packages/shared `Allocation`): a remembered allocation is a rule
    // from the next import on, so it reads as one now.
    expect(rows[0].matched_by).toBe("RULE");

    const { rows: rules } = await db.query<{ n: number }>(
      "select count(*)::int as n from ecapital.allocation_rule where project_id = $1",
      [projectA],
    );
    expect(rules[0].n).toBeGreaterThan(0);

    // A skipped row is not a rejected one: somebody comes back to it, and
    // allocating it puts it back in the ledger.
    const late = await post(`/cost/imports/${batchId}/allocate`)
      .set(bearer(token))
      .send({ txnIds: [third.txn.id], projectId: projectA, contractId: null, remember: false });
    expect(late.status).toBe(200);

    const committed = await post(`/cost/imports/${batchId}/commit`).set(bearer(token));
    expect(committed.status).toBe(200);
    expect(committed.body.status).toBe("COMMITTED");
    expect(committed.body.rowsUnmatched).toBe(0);
  });

  it("keeps whatever was left behind in the batch, as an exception", async () => {
    // R14: closing a batch with rows still unmatched does not lose them. Each
    // one becomes an entry in the exceptions list, so the reconciliation says
    // what was not placed and the next month's allocator can find it.
    const token = await tokenFor(app, USERS.finance);
    const imported = await upload(KSB1, { report: "KSB1", period: "2026-02", dryRun: false });
    const batchId = imported.body.id;

    const queue = await get(`/cost/imports/${batchId}/unmatched`).set(bearer(token));
    const left = queue.body.items.map((item: { txn: { id: string } }) => item.txn.id);
    expect(left.length).toBeGreaterThan(0);

    await post(`/cost/imports/${batchId}/skip`).set(bearer(token)).send({ txnIds: left });
    const committed = await post(`/cost/imports/${batchId}/commit`).set(bearer(token));
    expect(committed.status).toBe(200);
    expect(
      committed.body.exceptions.filter((e: { rule: string }) => e.rule === "SKIPPED"),
    ).toHaveLength(left.length);
  });

  /** CAPEX-01 §14, the M2 definition of done. */
  it("leaves under 5% of the month unmatched once the queue has been worked", async () => {
    const token = await tokenFor(app, USERS.finance);
    const list = await get("/cost/imports").set(bearer(token));
    const batch = list.body.items.find((item: { period: string }) => item.period === "2026-01");
    const detail = await get(`/cost/imports/${batch.id}`).set(bearer(token));
    const { rowsIn, rowsUnmatched } = detail.body;
    expect(rowsUnmatched / rowsIn).toBeLessThan(0.05);
  });

  it("applies a remembered rule on the next extract without anybody asking", async () => {
    // The rule written above is vendor plus narrative; the same vendor and
    // the same narrative next month is matchedBy RULE and never reaches the
    // queue. FBL1N carries two of them.
    const response = await upload(FBL1N, { report: "FBL1N", period: "2026-03", dryRun: false });
    expect(response.status).toBe(201);
    const { rows } = await db.query<{ matched_by: string; n: number }>(
      "select matched_by, count(*)::int as n from ecapital.cost_txn where import_batch_id = $1 group by matched_by",
      [response.body.id],
    );
    const byReason = new Map(rows.map((row) => [row.matched_by, row.n]));
    expect(byReason.get("WBS")).toBe(2);
    expect(byReason.get("PO")).toBe(2);

    // RULE (the profile's sign convention): a vendor invoice is a credit on
    // the vendor account and spend in the ledger; its credit note goes back.
    const { rows: invoice } = await db.query<{ amount: string }>(
      "select amount from ecapital.cost_txn where import_batch_id = $1 and description = 'Τιμολόγιο 4417'",
      [response.body.id],
    );
    expect(Number(invoice[0].amount)).toBe(40_000);
    const { rows: creditNote } = await db.query<{ amount: string }>(
      "select amount from ecapital.cost_txn where import_batch_id = $1 and description = 'Πιστωτικό 12'",
      [response.body.id],
    );
    expect(Number(creditNote[0].amount)).toBe(-3_200);
  });

  it("writes KSB1 to the actuals ledger and matches it on the cost centre", async () => {
    const token = await tokenFor(app, USERS.finance);
    const list = await get("/cost/imports").set(bearer(token));
    const batch = list.body.items.find(
      (item: { report: string; period: string }) => item.report === "KSB1" && item.period === "2026-02",
    );
    const { rows } = await db.query<{ txn_type: string; matched_by: string; n: number }>(
      "select txn_type, matched_by, count(*)::int as n from ecapital.cost_txn where import_batch_id = $1 group by txn_type, matched_by",
      [batch.id],
    );
    expect(rows.every((row) => row.txn_type === "ACTUAL")).toBe(true);
    const byReason = new Map(rows.map((row) => [row.matched_by, row.n]));
    expect(byReason.get("WBS")).toBe(3);
    expect(byReason.get("COST_CENTRE")).toBe(2);
    // The three left over carry a cost centre nothing holds. One of them is
    // the vendor and the narrative somebody allocated by hand on the ME2N
    // extract, so the remembered rule places it without being asked — which
    // is R14's whole reason for remembering.
    expect(byReason.get("RULE")).toBe(1);
    expect(byReason.get("NONE")).toBe(2);
  });

  // ------------------------------------------------------------- access --

  it("lets the three money roles import and nobody else", async () => {
    for (const email of [USERS.engineerLarnaca, USERS.technicianNicosia, USERS.auditor]) {
      const refused = await upload(KSB1, { report: "KSB1", period: "2026-04" }, email);
      expect(refused.status).toBe(403);
    }
  });

  it("lets an engineer work the queue in their own units and refuses another unit", async () => {
    const token = await tokenFor(app, USERS.finance);
    // A .csv, because a SAP client that cannot save a workbook can always
    // save a list — and because this needs a file nothing has imported yet.
    const csv = [
      "Document Number;Line Item;Document Date;Posting Date;Val.in rep.cur.;Name;Partner;WBS Element;Cost Center;Cost Element",
      "4911001;1;31.05.2026;31.05.2026;1.500,00;Εργασίες περίφραξης;ΙΩΤΑ ΕΡΓΑ ΛΤΔ;;CC9998;0802200",
      "4911002;1;31.05.2026;31.05.2026;900,50;Εργασίες περίφραξης, φάση 2;ΙΩΤΑ ΕΡΓΑ ΛΤΔ;;CC9998;0802200",
    ].join("\n");
    const fresh = await post("/cost/imports")
      .set(bearer(token))
      .field("report", "KSB1")
      .field("period", "2026-05")
      .field("dryRun", "false")
      .attach("file", Buffer.from(csv, "utf8"), "KSB1_2026_05.csv");
    expect(fresh.status).toBe(201);
    const batchId = fresh.body.id;
    expect(fresh.body.rowsIn).toBe(2);
    expect(fresh.body.rowsUnmatched).toBe(2);

    const queue = await get(`/cost/imports/${batchId}/unmatched`).set(bearer(token));
    const row = queue.body.items[0];

    const engineerToken = await tokenFor(app, USERS.engineerLarnaca);
    // The engineer is at Larnaca and this project is at Nicosia. RULE
    // (ADR-0010): a row the caller may not see does not exist for them, so
    // the answer is 404 and not 403 — a 403 would confirm the project is
    // there, which is the one fact somebody outside its unit should not
    // learn from an allocation form.
    const refused = await post(`/cost/imports/${batchId}/allocate`)
      .set(bearer(engineerToken))
      .send({ txnIds: [row.txn.id], projectId: projectA, contractId: null, remember: false });
    expect(refused.status).toBe(404);

    const own = await projectAt(
      app,
      "IN_PROGRESS",
      "Έργο μηχανικού Λάρνακας για κόστος",
      USERS.engineerLarnaca,
      "larnaca-general",
    );
    const allowed = await post(`/cost/imports/${batchId}/allocate`)
      .set(bearer(engineerToken))
      .send({ txnIds: [row.txn.id], projectId: own.id, contractId: null, remember: false });
    expect(allowed.status).toBe(200);
  });

  it("refuses a read-only account every write on the queue", async () => {
    const auditor = await tokenFor(app, USERS.auditor);
    const list = await get("/cost/imports").set(bearer(auditor));
    expect(list.status).toBe(200);
    const batchId = list.body.items[0].id;
    const refused = await post(`/cost/imports/${batchId}/allocate`)
      .set(bearer(auditor))
      .send({ txnIds: ["00000000-0000-0000-0000-000000000001"], projectId: projectA, contractId: null, remember: false });
    expect(refused.status).toBe(403);
  });

  // -------------------------------------------------------------- seams --

  it("has the MCP reader in place, saying it has nothing to talk to", async () => {
    // R15. The seam is checked rather than asserted: the reader implements
    // the same interface and is reached the same way; what it lacks is a
    // server, and it says so in the caller's language.
    const reader = new SapMcpReader();
    await expect(async () => {
      for await (const row of reader.read({ report: "ME2N", period: "2026-01", payload: null })) {
        throw new Error(`the stub produced a row: ${JSON.stringify(row)}`);
      }
    }).rejects.toMatchObject({ messageKey: "errors.costSourceNotConfigured" });
  });

  it("folds a vendor name the same way in TypeScript and in SQL", async () => {
    // R14 keys a remembered rule on the folded vendor name. The rule's key is
    // folded by Postgres when it is stored and the incoming row is folded in
    // TypeScript before it is looked up; if the two ever disagreed, every
    // remembered rule would quietly stop matching.
    const samples = [
      "ΑΛΦΑ ΤΕΧΝΙΚΗ ΛΤΔ",
      "Άλφα Τεχνική Λτδ",
      "ΔΟΜΗΣΗ & ΣΥΝΕΡΓΑΤΕΣ",
      "Πολυτεχνική ΑΕ",
      "Alpha Technical Ltd",
    ];
    for (const sample of samples) {
      const { rows } = await db.query<{ folded: string }>(
        "select ecapital.normalise($1) as folded",
        [sample],
      );
      expect(normalise(sample)).toBe(rows[0].folded);
    }
    expect(ruleText("Τιμολόγιο 4417/ΜΑΡΤΙΟΣ")).toBe(ruleText("Τιμολόγιο 4692 / Μάρτιος"));
  });
});
