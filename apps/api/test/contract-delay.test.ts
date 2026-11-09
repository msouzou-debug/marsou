import type { INestApplication } from "@nestjs/common";
import {
  ContractDelay,
  ContractDetail,
  type ExceptionsReport,
  ProjectSummary,
} from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, allProjects, bearer, createTestApp, tokenFor } from "./app";
import { makeContract } from "./contract-support";

/**
 * ADR-0035 — sections, extensions of time, claims and the delay penalty on
 * the contract, from the ΜΕΕ report of November 2026. The figures are
 * computed on read and shown; nothing here posts a deduction.
 */
const LARNACA = "larnaca-general";

const section = (code: string, overrides: Record<string, unknown> = {}) => ({
  code,
  titleEl: `Τμήμα ${code}`,
  completionDate: "2024-12-03",
  handoverDate: null,
  liquidatedDamagesPerDay: null,
  sortOrder: 1,
  ...overrides,
});

const extension = (overrides: Record<string, unknown> = {}) => ({
  sectionId: null,
  days: 40,
  approvedAt: "2026-05-28",
  approver: "KEAA",
  approverNameEl: "Κεντρική Επιτροπή Αλλαγών και Απαιτήσεων",
  reasonEl: "Καθυστέρηση στην παράδοση εξοπλισμού από τρίτο προμηθευτή.",
  contractorCulpable: false,
  ...overrides,
});

const claim = (overrides: Record<string, unknown> = {}) => ({
  direction: "BY_CONTRACTOR",
  titleEl: "Αξίωση αναδόχου για πρόσθετο κόστος",
  amount: 2_532_848.76,
  stage: "COURT",
  notifiedAt: "2025-10-15",
  legalAdvisorEl: "Νομική Υπηρεσία",
  contingentLiability: true,
  notesEl: "",
  ...overrides,
});

describe("delay penalties, extensions of time and claims (ADR-0035)", () => {
  let app: INestApplication;
  let db: Client;
  const http = () => request(app.getHttpServer());
  /**
   * The contracts this suite builds are late on purpose. They are taken out
   * again afterwards, because a late contract is a portfolio exception and the
   * portfolio has eight places that later suites count on (the seed's own).
   */
  const made: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await db.connect();
  });
  afterAll(async () => {
    if (made.length) await db.query("delete from ecapital.contract where id = any($1::uuid[])", [made]);
    await db.end();
    await app.close();
  });

  async function send(
    method: "post" | "patch" | "delete" | "get",
    path: string,
    email: string,
    body?: unknown,
  ) {
    const token = await tokenFor(app, email);
    const call = http()[method](path).set(bearer(token));
    return body === undefined ? call : call.send(body as object);
  }

  /** A Larnaca contract, past its completion, at €1.000 a day. */
  async function larnacaContract(stamp: string, overrides: Record<string, unknown> = {}) {
    const created = await makeContract(
      app,
      stamp,
      { completionDate: "2024-12-03", liquidatedDamagesPerDay: 1000, ...overrides },
      USERS.admin,
      LARNACA,
    );
    made.push(created.contract.id);
    return created;
  }

  it("adds, changes and removes sections, each with its own clock, the code unique on the contract", async () => {
    const { contract } = await larnacaContract(`sec-${Date.now()}`);
    const path = `/contracts/${contract.id}/sections`;

    const first = await send("post", path, USERS.engineerLarnaca, section("Α", { handoverDate: "2025-09-11" }));
    expect(first.status).toBe(201);
    const withA = ContractDetail.parse(first.body);
    expect(withA.sections).toHaveLength(1);
    expect(withA.delay?.clocks.map((c) => c.sectionCode)).toEqual(["Α"]);
    // Larnaca Section Α: 282 calendar days at €1.000.
    expect(withA.delay?.clocks[0]).toMatchObject({ daysLate: 282, amount: 282_000 });
    expect(withA.warnings.map((w) => w.key)).toContain("delayPenaltyAccruing");
    const accruing = withA.warnings.find((w) => w.key === "delayPenaltyAccruing");
    expect(accruing?.amount).toBe(282_000);
    expect(accruing?.sentenceEl).toContain("ρήτρα καθυστέρησης");
    expect(accruing?.sentenceEl).not.toMatch(/[Ππ]οινή/);

    const second = await send(
      "post",
      path,
      USERS.engineerLarnaca,
      section("Β", { completionDate: "2026-06-18", sortOrder: 2 }),
    );
    expect(second.status).toBe(201);
    expect(ContractDetail.parse(second.body).sections?.map((s) => s.code)).toEqual(["Α", "Β"]);

    const taken = await send("post", path, USERS.engineerLarnaca, section("Α"));
    expect(taken.status).toBe(422);
    expect(taken.body.key).toBe("errors.sectionCodeTaken");

    const sectionB = ContractDetail.parse(second.body).sections!.find((s) => s.code === "Β")!;
    const changed = await send("patch", `${path}/${sectionB.id}`, USERS.engineerLarnaca, {
      handoverDate: "2026-06-28",
    });
    expect(changed.status).toBe(200);
    const clockB = ContractDetail.parse(changed.body).delay!.clocks.find((c) => c.sectionCode === "Β")!;
    expect(clockB).toMatchObject({ handoverDate: "2026-06-28", daysLate: 10, amount: 10_000 });

    const clash = await send("patch", `${path}/${sectionB.id}`, USERS.engineerLarnaca, { code: "Α" });
    expect(clash.status).toBe(422);
    expect(clash.body.key).toBe("errors.sectionCodeTaken");

    const removed = await send("delete", `${path}/${sectionB.id}`, USERS.engineerLarnaca);
    expect(removed.status).toBe(200);
    expect(ContractDetail.parse(removed.body).sections?.map((s) => s.code)).toEqual(["Α"]);

    const missing = await send("delete", `${path}/${sectionB.id}`, USERS.engineerLarnaca);
    expect(missing.status).toBe(404);
    expect(missing.body.key).toBe("errors.sectionNotFound");
  });

  it("lets the project engineer write a section and refuses finance and the auditor", async () => {
    const { contract } = await larnacaContract(`perm-${Date.now()}`);
    const path = `/contracts/${contract.id}/sections`;
    expect((await send("post", path, USERS.engineerLarnaca, section("Α"))).status).toBe(201);
    const finance = await send("post", path, USERS.finance, section("Β"));
    expect(finance.status).toBe(403);
    expect(finance.body.key).toBe("errors.notAllowed");
    const auditor = await send("post", path, USERS.auditor, section("Β"));
    expect(auditor.status).toBe(403);
    expect(auditor.body.key).toBe("errors.readOnlyAccount");
    // Finance reads everything.
    const read = await send("get", `/contracts/${contract.id}`, USERS.finance);
    expect(read.status).toBe(200);
    expect(ContractDetail.parse(read.body).sections).toHaveLength(1);
    // Another unit's engineer does not reach the contract at all (ADR-0010).
    expect((await send("post", path, USERS.estatesNicosia, section("Γ"))).status).toBe(404);
  });

  it("records extensions as rows, keeps extension_days in step and moves the due date", async () => {
    const { contract } = await larnacaContract(`ext-${Date.now()}`, { completionDate: "2026-06-18" });
    const path = `/contracts/${contract.id}/extensions`;

    const added = await send("post", path, USERS.engineerLarnaca, extension());
    expect(added.status).toBe(201);
    const detail = ContractDetail.parse(added.body);
    expect(detail.extensionDays).toBe(40);
    expect(detail.extensions).toHaveLength(1);
    expect(detail.extensions?.[0]).toMatchObject({
      days: 40,
      approver: "KEAA",
      contractorCulpable: false,
      createdByName: expect.any(String),
    });
    expect(detail.delay?.clocks[0]).toMatchObject({ extensionDays: 40, dueDate: "2026-07-28" });

    const culpable = await send(
      "post",
      path,
      USERS.engineerLarnaca,
      extension({ days: 5, approver: "TEAA", contractorCulpable: true }),
    );
    const both = ContractDetail.parse(culpable.body);
    expect(both.extensionDays).toBe(45);
    expect(both.delay?.clocks[0].culpableExtensionDays).toBe(5);

    // The trigger, not the API, keeps the column: what the database holds.
    const stored = async () =>
      (await db.query<{ extension_days: number }>(
        "select extension_days from ecapital.contract where id = $1",
        [contract.id],
      )).rows[0].extension_days;
    expect(await stored()).toBe(45);

    // Typing the number is not a way round it: the shape drops it and the
    // database would overwrite it anyway.
    const typed = await send("patch", `/contracts/${contract.id}`, USERS.engineerLarnaca, {
      extensionDays: 999,
      sapPoNumber: "4500900002",
    });
    expect(typed.status).toBe(200);
    expect(ContractDetail.parse(typed.body).extensionDays).toBe(45);
    await db.query("update ecapital.contract set extension_days = 7 where id = $1", [contract.id]);
    expect(await stored()).toBe(45);

    const removed = await send("delete", `${path}/${both.extensions![0].id}`, USERS.engineerLarnaca);
    expect(removed.status).toBe(200);
    expect(await stored()).toBe(both.extensions!.slice(1).reduce((sum, e) => sum + e.days, 0));

    const elsewhere = await larnacaContract(`ext-other-${Date.now()}`);
    const foreign = await send(
      "post",
      `/contracts/${elsewhere.contract.id}/sections`,
      USERS.engineerLarnaca,
      section("Α"),
    );
    const foreignSection = ContractDetail.parse(foreign.body).sections![0];
    const wrong = await send("post", path, USERS.engineerLarnaca, extension({ sectionId: foreignSection.id }));
    expect(wrong.status).toBe(422);
    expect(wrong.body.key).toBe("errors.sectionNotOnContract");

    expect((await send("post", path, USERS.finance, extension())).status).toBe(403);
    const invalid = await send("post", path, USERS.engineerLarnaca, extension({ days: 0 }));
    expect(invalid.status).toBe(400);
    expect(invalid.body.key).toBe("errors.extensionNotValid");
  });

  it("records claims, changes their stage and counts the open ones", async () => {
    const { contract } = await larnacaContract(`claim-${Date.now()}`);
    const path = `/contracts/${contract.id}/claims`;

    const added = await send("post", path, USERS.engineerLarnaca, claim());
    expect(added.status).toBe(201);
    const counter = await send(
      "post",
      path,
      USERS.engineerLarnaca,
      claim({ direction: "BY_ORGANISATION", amount: 2_508_506.69, contingentLiability: false }),
    );
    const detail = ContractDetail.parse(counter.body);
    expect(detail.claims).toHaveLength(2);
    expect(detail.delay).toMatchObject({
      openClaims: 2,
      claimedByContractor: 2_532_848.76,
      claimedByOrganisation: 2_508_506.69,
    });
    const warning = detail.warnings.find((w) => w.key === "claimsOpen");
    expect(warning?.amount).toBe(2_532_848.76);
    expect(warning?.sentenceEl).toContain("αξιώσεις");

    const byContractor = detail.claims!.find((c) => c.direction === "BY_CONTRACTOR")!;
    const settled = await send("patch", `${path}/${byContractor.id}`, USERS.engineerLarnaca, {
      stage: "SETTLED",
    });
    expect(settled.status).toBe(200);
    const after = ContractDetail.parse(settled.body);
    expect(after.claims!.find((c) => c.id === byContractor.id)).toMatchObject({
      stage: "SETTLED",
      amount: 2_532_848.76,
      contingentLiability: true,
    });
    expect(after.delay).toMatchObject({ openClaims: 1, claimedByContractor: 0 });

    expect((await send("patch", `${path}/${byContractor.id}`, USERS.finance, { stage: "COURT" })).status).toBe(403);
    const unknown = await send("patch", `${path}/00000000-0000-4000-8000-000000000000`, USERS.engineerLarnaca, {
      stage: "COURT",
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.key).toBe("errors.claimNotFound");
  });

  it("lets the head of estates activate the penalty and refuses the engineer and finance", async () => {
    const nicosia = await makeContract(app, `act-${Date.now()}`, {
      completionDate: "2026-01-10",
      liquidatedDamagesPerDay: 300,
    });
    made.push(nicosia.contract.id);
    const path = `/contracts/${nicosia.contract.id}/delay/activate`;
    const body = { sectionId: null, activatedAt: "2026-02-01", noteEl: "Ενεργοποίηση ρήτρας καθυστέρησης." };

    expect((await send("post", path, USERS.finance, body)).status).toBe(403);

    const activated = await send("post", path, USERS.estatesNicosia, body);
    expect(activated.status).toBe(200);
    const detail = ContractDetail.parse(activated.body);
    expect(detail.ldActivatedAt).toBe("2026-02-01");
    expect(detail.ldActivationNoteEl).toBe("Ενεργοποίηση ρήτρας καθυστέρησης.");
    expect(detail.delay?.clocks[0].activatedAt).toBe("2026-02-01");

    // The Larnaca engineer writes sections but does not activate the clause.
    const { contract } = await larnacaContract(`act-l-${Date.now()}`);
    const engineer = await send("post", `/contracts/${contract.id}/delay/activate`, USERS.engineerLarnaca, body);
    expect(engineer.status).toBe(403);

    // A contract with sections has no clock of its own.
    const withSection = await send("post", `/contracts/${nicosia.contract.id}/sections`, USERS.estatesNicosia, section("Α"));
    expect(withSection.status).toBe(201);
    const refused = await send("post", path, USERS.estatesNicosia, body);
    expect(refused.status).toBe(422);
    expect(refused.body.key).toBe("errors.contractHasSections");

    const sectionId = ContractDetail.parse(withSection.body).sections![0].id;
    const onSection = await send("post", path, USERS.admin, { ...body, sectionId });
    expect(onSection.status).toBe(200);
    expect(ContractDetail.parse(onSection.body).sections![0].ldActivatedAt).toBe("2026-02-01");

    const delay = await send("get", `/contracts/${nicosia.contract.id}/delay`, USERS.finance);
    expect(delay.status).toBe(200);
    const parsed = ContractDelay.parse(delay.body);
    expect(parsed.clocks[0]).toMatchObject({ sectionId, activatedAt: "2026-02-01" });
  });

  it("puts the activation, sections, extensions and claims in the audit trail", async () => {
    const { contract } = await larnacaContract(`audit-${Date.now()}`);
    await send("post", `/contracts/${contract.id}/sections`, USERS.engineerLarnaca, section("Α"));
    await send("post", `/contracts/${contract.id}/extensions`, USERS.engineerLarnaca, extension());
    await send("post", `/contracts/${contract.id}/claims`, USERS.engineerLarnaca, claim());
    const { rows } = await db.query<{ entity_type: string }>(
      `select distinct entity_type from ecapital.audit_log
        where entity_type in ('contract_section', 'contract_extension', 'contract_claim')
          and (after ->> 'contract_id') = $1`,
      [contract.id],
    );
    expect(rows.map((r) => r.entity_type).sort()).toEqual([
      "contract_claim",
      "contract_extension",
      "contract_section",
    ]);
  });

  it("carries lastActivityAt on the project list and moves it when a child changes", async () => {
    const { project, contract } = await larnacaContract(`fresh-${Date.now()}`);
    const { items } = await allProjects(app, USERS.admin);
    expect(items.every((p) => typeof p.lastActivityAt === "string")).toBe(true);

    await db.query(
      `update ecapital.project set updated_at = now() - interval '90 days' where id = $1`,
      [project.id],
    );
    await db.query(
      `update ecapital.contract set updated_at = now() - interval '45 days' where id = $1`,
      [contract.id],
    );
    const listed = (await allProjects(app, USERS.admin)).items.find((p) => p.id === project.id)!;
    const days = (Date.now() - Date.parse(listed.lastActivityAt!)) / 86_400_000;
    expect(Math.round(days)).toBe(45);

    const detail = await send("get", `/projects/${project.id}`, USERS.admin);
    expect(ProjectSummary.parse(detail.body).lastActivityAt).toBe(listed.lastActivityAt);
  });

  it("lists a stale project in the exceptions report with its penalty and open claims", async () => {
    const { project, contract } = await larnacaContract(`stale-${Date.now()}`);
    await send("post", `/contracts/${contract.id}/claims`, USERS.engineerLarnaca, claim());
    // A green project nobody has touched for forty days.
    await db.query(`update ecapital.project set rag = 'GREEN', updated_at = now() - interval '40 days' where id = $1`, [
      project.id,
    ]);
    await db.query(`update ecapital.contract set updated_at = now() - interval '40 days' where id = $1`, [contract.id]);
    await db.query(`update ecapital.contract_claim set updated_at = now() - interval '40 days' where contract_id = $1`, [
      contract.id,
    ]);

    const token = await tokenFor(app, USERS.admin);
    const response = await http().get("/reports/exceptions").set(bearer(token));
    expect(response.status).toBe(200);
    const body = response.body as ExceptionsReport;
    const row = body.rows.find((r) => r.projectId === project.id);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ rag: "GREEN", stale: true, openClaims: 1 });
    expect(row!.daysSinceActivity).toBeGreaterThanOrEqual(40);
    expect(row!.delayDaysLate).toBeGreaterThan(0);
    expect(row!.delayPenaltyAmount).toBe(row!.delayDaysLate * 1000);
    // Red and amber first, then the stale ones.
    const firstGreen = body.rows.findIndex((r) => r.rag === "GREEN");
    expect(body.rows.slice(firstGreen).every((r) => r.rag === "GREEN" && r.stale)).toBe(true);
  });

  it("carries the accrued penalty and the culpable days on the contractor scorecard", async () => {
    const { contract, contractorId } = await larnacaContract(`score-${Date.now()}`);
    await send(
      "post",
      `/contracts/${contract.id}/extensions`,
      USERS.engineerLarnaca,
      extension({ days: 6, contractorCulpable: true }),
    );
    const token = await tokenFor(app, USERS.admin);
    const response = await http().get("/reports/contractor-scorecard").set(bearer(token));
    expect(response.status).toBe(200);
    const row = (response.body.capital as { contractorId: string; delayPenaltyAccrued: number | null; culpableExtensionDays: number }[])
      .find((r) => r.contractorId === contractorId);
    expect(row?.culpableExtensionDays).toBe(6);
    expect(row?.delayPenaltyAccrued).toBeGreaterThan(0);
  });

  it("seeds the Larnaca example: two sections, one activated, one extension, the claim in court", async () => {
    const { rows } = await db.query<{ id: string }>(
      `select c.id from ecapital.contract c
         join ecapital.contract_section s on s.contract_id = c.id
        where c.org_unit_id = 'larnaca-general' and s.code = 'Α' and s.handover_date = '2025-09-11'
        limit 1`,
    );
    expect(rows).toHaveLength(1);
    const response = await send("get", `/contracts/${rows[0].id}`, USERS.admin);
    const detail = ContractDetail.parse(response.body);
    expect(detail.sections?.map((s) => s.code)).toEqual(["Α", "Β"]);
    expect(detail.delay?.clocks[0]).toMatchObject({ daysLate: 282, amount: 282_000, activatedAt: "2025-07-21" });
    expect(detail.delay?.clocks[1]).toMatchObject({ extensionDays: 40, dueDate: "2026-07-28" });
    expect(detail.extensionDays).toBe(40);
    expect(detail.claims?.some((c) => c.stage === "COURT" && c.amount === 2_532_848.76 && c.contingentLiability)).toBe(
      true,
    );
  });
});
