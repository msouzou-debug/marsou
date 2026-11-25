import type { INestApplication } from "@nestjs/common";
import { nicosiaDateOf } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { contractBody, makeContract, makeContractor, projectAt, projectBody } from "./contract-support";

/**
 * Date sanity (owner request, 25/11/2026; packages/shared/src/calendar-date.ts): a
 * date that records something that already happened is not after today in
 * Nicosia, and an end is not before its start. These are the API's half; the
 * web form says the same under the field.
 */
function dayAfter(iso: string, days = 1): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

describe("date sanity on the API", () => {
  let app: INestApplication;
  let db: Client;
  const http = () => request(app.getHttpServer());
  const today = nicosiaDateOf();
  const tomorrow = dayAfter(today);
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

  async function send(method: "post" | "patch", path: string, body: unknown, email: string = USERS.admin) {
    const token = await tokenFor(app, email);
    return http()[method](path).set(bearer(token)).send(body as object);
  }

  async function contract(stamp: string) {
    const created = await makeContract(app, `dates-${stamp}-${Date.now()}`);
    made.push(created.contract.id);
    return created;
  }

  describe("a contract", () => {
    it("refuses an award after today and a completion before the start", async () => {
      const project = await projectAt(app, "IN_PROGRESS", `Ημερομηνίες σύμβασης ${Date.now()}`);
      const contractor = await makeContractor(app, `Ανάδοχος ημερομηνιών ${Date.now()}`);
      const path = `/projects/${project.id}/contracts`;

      const future = await send("post", path, contractBody(project.id, contractor.id, `ΤΥ/ΗΜ/${Date.now()}`, { awardDate: tomorrow }));
      expect(future.status).toBe(400);
      expect(future.body.key).toBe("errors.dateInFuture");

      const backwards = await send(
        "post",
        path,
        contractBody(project.id, contractor.id, `ΤΥ/ΗΜ/${Date.now()}`, { completionDate: "2026-09-01" }),
      );
      expect(backwards.status).toBe(400);
      expect(backwards.body.key).toBe("errors.dateOrder");
    });

    it("checks a change against the dates already stored", async () => {
      const { contract: stored } = await contract("patch");
      // The fixture starts on 15/09/2026; a completion before it is refused
      // even though the body carries no start date.
      const refused = await send("patch", `/contracts/${stored.id}`, { completionDate: "2026-09-01" });
      expect(refused.status).toBe(400);
      expect(refused.body.key).toBe("errors.dateOrder");

      const fine = await send("patch", `/contracts/${stored.id}`, { completionDate: "2028-01-31" });
      expect(fine.status).toBe(200);
    });
  });

  describe("the ADR-0035 records", () => {
    it("refuses a claim notified tomorrow or before the award, on add and on change", async () => {
      const { contract: stored } = await contract("claim");
      const path = `/contracts/${stored.id}/claims`;
      const claim = {
        direction: "BY_CONTRACTOR",
        titleEl: "Αξίωση για πρόσθετο κόστος",
        amount: 10_000,
        stage: "NOTIFIED",
        notifiedAt: tomorrow,
        legalAdvisorEl: null,
        contingentLiability: false,
        notesEl: "",
      };

      const future = await send("post", path, claim);
      expect(future.status).toBe(400);
      expect(future.body.key).toBe("errors.dateInFuture");

      // The fixture contract was awarded on 01/09/2026.
      const early = await send("post", path, { ...claim, notifiedAt: "2026-08-31" });
      expect(early.status).toBe(400);
      expect(early.body.key).toBe("errors.dateBeforeAward");

      const added = await send("post", path, { ...claim, notifiedAt: today });
      expect(added.status).toBe(201);
      const id = (added.body.claims as { id: string }[])[0].id;

      const changed = await send("patch", `${path}/${id}`, { notifiedAt: tomorrow });
      expect(changed.status).toBe(400);
      expect(changed.body.key).toBe("errors.dateInFuture");

      // A change that does not touch the date is not held up by it.
      const staged = await send("patch", `${path}/${id}`, { stage: "UNDER_REVIEW" });
      expect(staged.status).toBe(200);
    });

    it("refuses an extension approved tomorrow or before the award", async () => {
      const { contract: stored } = await contract("ext");
      const path = `/contracts/${stored.id}/extensions`;
      const extension = {
        sectionId: null,
        days: 10,
        approvedAt: tomorrow,
        approver: "ENGINEER",
        approverNameEl: "Μηχανικός έργου",
        reasonEl: "Καιρικές συνθήκες.",
        contractorCulpable: false,
      };
      const future = await send("post", path, extension);
      expect(future.status).toBe(400);
      expect(future.body.key).toBe("errors.dateInFuture");

      const early = await send("post", path, { ...extension, approvedAt: "2026-01-15" });
      expect(early.status).toBe(400);
      expect(early.body.key).toBe("errors.dateBeforeAward");
    });

    it("refuses a section handed over tomorrow and an activation dated tomorrow", async () => {
      const { contract: stored } = await contract("sec");
      const section = {
        code: "Α",
        titleEl: "Τμήμα Α",
        completionDate: "2027-06-30",
        handoverDate: tomorrow,
        liquidatedDamagesPerDay: null,
        sortOrder: 1,
      };
      const handover = await send("post", `/contracts/${stored.id}/sections`, section);
      expect(handover.status).toBe(400);
      expect(handover.body.key).toBe("errors.dateInFuture");

      // A contractual completion date in the future is a plan, and fine.
      const planned = await send("post", `/contracts/${stored.id}/sections`, { ...section, handoverDate: null });
      expect(planned.status).toBe(201);

      const activation = await send("post", `/contracts/${stored.id}/delay/activate`, {
        sectionId: null,
        activatedAt: tomorrow,
        noteEl: "Ενεργοποίηση ρήτρας.",
      });
      expect(activation.status).toBe(400);
      expect(activation.body.key).toBe("errors.dateInFuture");
    });
  });

  describe("a project", () => {
    it("refuses a planned finish before the planned start, on create and on change", async () => {
      const body = { ...projectBody(`Ημερομηνίες έργου ${Date.now()}`), plannedFinish: "2026-12-31" };
      const created = await send("post", "/projects", body);
      expect(created.status).toBe(400);
      expect(created.body.key).toBe("errors.dateOrder");

      // Planned dates may be in the future: that is what a plan is.
      const fine = await send("post", "/projects", projectBody(`Ημερομηνίες έργου ${Date.now()}`));
      expect(fine.status).toBe(201);
      const changed = await send("patch", `/projects/${fine.body.id}`, { plannedFinish: "2026-12-31" });
      expect(changed.status).toBe(400);
      expect(changed.body.key).toBe("errors.dateOrder");
    });

    it("refuses a milestone met tomorrow and lets its forecast be in the future", async () => {
      const project = await send("post", "/projects", projectBody(`Ορόσημα ${Date.now()}`));
      const path = `/projects/${project.body.id}/milestones`;
      const milestone = {
        titleEl: "Παράδοση εξοπλισμού",
        baselineDate: "2027-06-30",
        forecastDate: "2027-07-15",
        actualDate: tomorrow,
        isGate: false,
        sortOrder: 1,
      };
      const met = await send("post", path, milestone);
      expect(met.status).toBe(400);
      expect(met.body.key).toBe("errors.dateInFuture");

      const planned = await send("post", path, { ...milestone, actualDate: null });
      expect(planned.status).toBe(201);
      const tick = await send("patch", `${path}/${planned.body.id}`, { ...milestone, actualDate: tomorrow });
      expect(tick.status).toBe(400);
      expect(tick.body.key).toBe("errors.dateInFuture");
    });
  });

  describe("a maintenance agreement", () => {
    it("refuses one that ends before it starts, on create and on change", async () => {
      const { rows } = await db.query<{ id: string }>("select id from ecapital.contractor order by name limit 1");
      const token = await tokenFor(app, USERS.estatesNicosia);
      const ref = `Α.Ο ΗΜ/${Date.now()}`;
      const body = {
        orgUnitId: "nicosia-general",
        contractorId: rows[0].id,
        ref,
        titleEl: "Συντήρηση δοκιμής",
        startDate: "2026-01-01",
        endDate: "2025-12-31",
      };
      const backwards = await http().post("/maintenance/contracts").set(bearer(token)).send(body);
      expect(backwards.status).toBe(400);
      expect(backwards.body.key).toBe("errors.dateOrder");

      const created = await http()
        .post("/maintenance/contracts")
        .set(bearer(token))
        .send({ ...body, endDate: "2028-12-31" });
      expect(created.status).toBe(201);
      const changed = await http()
        .patch(`/maintenance/contracts/${created.body.id}`)
        .set(bearer(token))
        .send({ startDate: "2029-01-01" });
      expect(changed.status).toBe(400);
      expect(changed.body.key).toBe("errors.dateOrder");
      await db.query("delete from ecapital.maintenance_contract where id = $1", [created.body.id]);
    });
  });
});
