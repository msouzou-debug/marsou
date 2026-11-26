import type { INestApplication } from "@nestjs/common";
import { ApproverScopes, type AdminUser, type AuditEntry, type Inbox, type ShutdownPermit } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { approvedPermit, draftPermit, nicosiaAreas, permitOf, runIcra, submit } from "./permit-support";

/**
 * Owner decision 26/11/2026, three weak points found while answering eHire on
 * eCapital's users and roles:
 *
 *   1. an approval line goes only to somebody active who holds a role that
 *      may decide it, and an administrator switching somebody off or taking a
 *      role away moves that person's pending lines in the same transaction;
 *      the handback acceptance asks the same question;
 *   2. an administrator decides only a line that waits on nobody, and is
 *      stamped as its approver;
 *   3. the user sheet saves roles and approver scopes in one request, judged
 *      against the roles being saved, writing only the rows that changed.
 *
 * Λάρνακα has no Infection Control appointment in the seed, so the people
 * this file appoints there are the only holders of that line while it runs.
 * Everything it appoints is taken away again in `afterAll`, because the
 * suites after it route Λάρνακα permits to nobody on purpose.
 */
describe("who an approval line may wait on (owner decision 26/11/2026)", () => {
  let app: INestApplication;
  let client: Client;
  let adminToken: string;
  let adminId: string;
  let larnacaTheatre: string;
  const stamp = Date.now();
  const made: string[] = [];
  const permits: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
    adminToken = await tokenFor(app, USERS.admin);
    adminId = await idOf(USERS.admin);
    const larnaca = await request(app.getHttpServer())
      .get("/org-units/larnaca-general/areas")
      .set(bearer(adminToken));
    larnacaTheatre = (larnaca.body.buildings as { floors: { areas: { code: string; id: string }[] }[] }[])
      .flatMap((b) => b.floors)
      .flatMap((f) => f.areas)
      .find((a) => a.code === "THE-01")!.id;
  });

  afterAll(async () => {
    try {
      // The permits this file left in review, so no later inbox counts them.
      for (const id of permits) {
        await request(app.getHttpServer())
          .post(`/permits/${id}/transition`)
          .set(bearer(adminToken))
          .send({ to: "REJECTED", commentEl: "Δοκιμή: καθαρισμός." });
      }
      if (made.length) {
        await client.query("delete from ecapital.unit_approver where user_id = any ($1::uuid[])", [made]);
        await client.query("delete from ecapital.area_clinical_owner where user_id = any ($1::uuid[])", [made]);
        await client.query("update ecapital.app_user set is_active = false where id = any ($1::uuid[])", [made]);
      }
    } finally {
      await client.end();
      await app.close();
    }
  });

  async function idOf(email: string): Promise<string> {
    const { rows } = await client.query("select id from ecapital.app_user where email = $1", [email]);
    return rows[0].id as string;
  }

  /** A fresh account, so nothing the seed or another suite relies on moves. */
  async function account(handle: string, roles: string[], orgUnitIds: string[]): Promise<AdminUser> {
    const response = await request(app.getHttpServer())
      .post("/admin/users")
      .set(bearer(adminToken))
      .send({ username: `${handle}.${stamp}`, name: `Δοκιμή ${handle}`, roles, orgUnitIds });
    expect(response.status).toBe(201);
    made.push(response.body.id);
    return response.body as AdminUser;
  }

  function patch(id: string, body: object) {
    return request(app.getHttpServer()).patch(`/admin/users/${id}`).set(bearer(adminToken)).send(body);
  }

  async function scopesOf(id: string): Promise<ApproverScopes> {
    const response = await request(app.getHttpServer())
      .get(`/admin/users/${id}/approver-scopes`)
      .set(bearer(adminToken));
    return ApproverScopes.parse(response.body);
  }

  async function permit(id: string): Promise<ShutdownPermit> {
    return (await permitOf(app, id, USERS.admin)).body as ShutdownPermit;
  }

  async function infectionControlOf(id: string) {
    return (await permit(id)).approvals.find((line) => line.role === "INFECTION_CONTROL")!;
  }

  async function auditOf(id: string): Promise<AuditEntry[]> {
    const response = await request(app.getHttpServer()).get(`/permits/${id}/audit`).set(bearer(adminToken));
    expect(response.status).toBe(200);
    return response.body as AuditEntry[];
  }

  /** A Class III+ request in a Λάρνακα theatre: its route has an Infection Control line. */
  async function larnacaPermit(what: string): Promise<ShutdownPermit> {
    const draft = await draftPermit(app, {
      titleEl: `${what} ${stamp}-${permits.length}`,
      areaIds: [larnacaTheatre],
      email: USERS.engineerLarnaca,
    });
    await runIcra(app, draft.id, "C", USERS.engineerLarnaca);
    const submitted = await submit(app, draft.id, USERS.engineerLarnaca);
    permits.push(submitted.id);
    return submitted;
  }

  async function scopeAudit(userId: string): Promise<{ action: string }[]> {
    const { rows } = await client.query(
      `select action from ecapital.audit_log
        where entity_type in ('unit_approver', 'area_clinical_owner')
          and coalesce(after ->> 'user_id', before ->> 'user_id') = $1
        order by id`,
      [userId],
    );
    return rows;
  }

  const ic = { orgUnitId: "larnaca-general", role: "INFECTION_CONTROL" as const };
  let first: AdminUser;
  let second: AdminUser;
  let one: string;
  let two: string;
  let three: string;

  // ------------------------------------------------------ fix 3, one save --

  it("saves a new role and the scope it allows in one request", async () => {
    first = await account("ic.first", ["project_engineer"], ["larnaca-general"]);
    second = await account("ic.second", ["project_engineer"], ["larnaca-general"]);
    for (const person of [first, second]) {
      const response = await patch(person.id, {
        name: person.name,
        roles: ["clinical_approver"],
        orgUnitIds: ["larnaca-general"],
        active: true,
        approverScopes: { areas: [], units: [ic] },
      });
      expect(response.status).toBe(200);
      expect((response.body as AdminUser).roles).toEqual(["clinical_approver"]);
      expect(await scopesOf(person.id)).toEqual({ areas: [], units: [ic] });
    }
    // One row added, one audit row: no delete-and-insert around it.
    expect((await scopeAudit(first.id)).map((row) => row.action)).toEqual(["INSERT"]);
  });

  it("refuses a combined save as a whole and changes nothing", async () => {
    const response = await patch(second.id, {
      name: "Άλλο όνομα",
      roles: ["technician"],
      orgUnitIds: ["larnaca-general"],
      active: true,
      approverScopes: { areas: [{ areaId: larnacaTheatre, role: "WARD_MANAGER" }], units: [ic] },
    });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.approverScopesNeedRole");

    const after = await request(app.getHttpServer()).get(`/admin/users/${second.id}`).set(bearer(adminToken));
    expect(after.body.name).toBe(second.name);
    expect(after.body.roles).toEqual(["clinical_approver"]);
    expect(await scopesOf(second.id)).toEqual({ areas: [], units: [ic] });
  });

  // ------------------------------------------------------ fix 1, routing --

  it("routes to the earliest appointment while it is active and holds the role", async () => {
    one = (await larnacaPermit("Πρώτη άδεια")).id;
    expect((await infectionControlOf(one)).approverId).toBe(first.id);
  });

  it("moves the pending line of an account switched off, and routes past it", async () => {
    const response = await patch(first.id, { active: false });
    expect(response.status).toBe(200);
    expect((await infectionControlOf(one)).approverId).toBe(second.id);

    // Recorded in the permit's own history, by the administrator.
    const moved = (await auditOf(one)).filter((entry) => entry.action === "permitLineReassigned");
    expect(moved).toHaveLength(1);
    expect(moved[0].detail).toBe("INFECTION_CONTROL");
    expect(moved[0].actorName).toBe("Μαρία Κωνσταντίνου");

    two = (await larnacaPermit("Δεύτερη άδεια")).id;
    expect((await infectionControlOf(two)).approverId).toBe(second.id);
    // The scope rows stay: switched back on, the account has them again.
    expect(await scopesOf(first.id)).toEqual({ areas: [], units: [ic] });
  });

  it("routes past an active account that lost the role, and keeps its scope rows", async () => {
    const before = (await scopeAudit(first.id)).length;
    // Back on, without the role; the scope is sent as it is, so it is kept,
    // not refused (keeping is not granting) and not rewritten.
    const response = await patch(first.id, {
      name: first.name,
      roles: ["technician"],
      orgUnitIds: ["larnaca-general"],
      active: true,
      approverScopes: { areas: [], units: [ic] },
    });
    expect(response.status).toBe(200);
    expect(await scopesOf(first.id)).toEqual({ areas: [], units: [ic] });
    expect((await scopeAudit(first.id)).length).toBe(before);

    three = (await larnacaPermit("Τρίτη άδεια")).id;
    expect((await infectionControlOf(three)).approverId).toBe(second.id);
  });

  it("moves the lines once when a role and its scope go in one save, to nobody when nobody is left", async () => {
    const response = await patch(second.id, {
      name: second.name,
      roles: ["technician"],
      orgUnitIds: ["larnaca-general"],
      active: true,
      approverScopes: { areas: [], units: [] },
    });
    expect(response.status).toBe(200);
    for (const id of [one, two, three]) {
      expect((await infectionControlOf(id)).approverId).toBeNull();
    }
    const movedOnce = (await auditOf(two)).filter((entry) => entry.action === "permitLineReassigned");
    expect(movedOnce).toHaveLength(1);
    // Twice in all for the first permit: first → second, second → nobody.
    expect((await auditOf(one)).filter((entry) => entry.action === "permitLineReassigned")).toHaveLength(2);
    // The scope removed is one DELETE, nothing re-inserted.
    expect((await scopeAudit(second.id)).map((row) => row.action)).toEqual(["INSERT", "DELETE"]);
  });

  // ----------------------------------------------- fix 2, the administrator --

  it("lets the administrator decide a line that waits on nobody, stamped as its approver", async () => {
    const line = await infectionControlOf(two);
    const response = await request(app.getHttpServer())
      .post(`/permits/${two}/approvals/${line.id}/decide`)
      .set(bearer(adminToken))
      .send({ decision: "APPROVED", commentEl: null });
    expect(response.status).toBe(200);
    const decided = (response.body as ShutdownPermit).approvals.find((l) => l.id === line.id)!;
    expect(decided.decision).toBe("APPROVED");
    expect(decided.approverId).toBe(adminId);
    expect(decided.approverName).toBe("Μαρία Κωνσταντίνου");
  });

  it("refuses the administrator a line that waits on somebody else, and leaves it as it was", async () => {
    const assigned = (await permit(two)).approvals.find(
      (line) => line.decision === "PENDING" && line.approverId !== null,
    );
    expect(assigned).toBeDefined();
    const response = await request(app.getHttpServer())
      .post(`/permits/${two}/approvals/${assigned!.id}/decide`)
      .set(bearer(adminToken))
      .send({ decision: "APPROVED", commentEl: null });
    expect(response.status).toBe(403);
    expect(response.body.key).toBe("errors.permitDecisionAssignedToOther");
    const after = (await permit(two)).approvals.find((line) => line.id === assigned!.id)!;
    expect(after.decision).toBe("PENDING");
    expect(after.approverId).toBe(assigned!.approverId);
  });

  it("answers the eligibility question only inside a request", async () => {
    const { rows } = await client.query(
      "select user_id from ecapital.eligible_approvers($1::uuid[], array['clinical_approver'])",
      [[second.id]],
    );
    expect(rows).toEqual([]);
  });
});

/**
 * The handback acceptance (0035) asks the same question: a scope left on an
 * account switched off, or on one that lost the clinical approver role,
 * signs nothing — not offered in the inbox or on the permit, refused by the
 * API, even with a token minted while the account still had both.
 */
describe("who may accept a handback (owner decision 26/11/2026)", () => {
  let app: INestApplication;
  let client: Client;
  let adminToken: string;
  let officeArea: string;
  let officer: AdminUser;
  const stamp = Date.now();
  const waitingIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
    adminToken = await tokenFor(app, USERS.admin);
    officeArea = (await nicosiaAreas(app)).office;
    const created = await request(app.getHttpServer())
      .post("/admin/users")
      .set(bearer(adminToken))
      .send({
        username: `nursing.temp.${stamp}`,
        name: "Δοκιμή νοσηλευτικής",
        roles: ["clinical_approver"],
        orgUnitIds: ["nicosia-general"],
      });
    expect(created.status).toBe(201);
    officer = created.body as AdminUser;
    const scoped = await request(app.getHttpServer())
      .patch(`/admin/users/${officer.id}`)
      .set(bearer(adminToken))
      .send({ approverScopes: { areas: [], units: [{ orgUnitId: "nicosia-general", role: "NURSING" }] } });
    expect(scoped.status).toBe(200);
  });

  afterAll(async () => {
    try {
      // Accept what this file left waiting, so no later inbox finds it.
      const clinical = await tokenFor(app, USERS.clinicalNicosia);
      for (const id of waitingIds) await accept(clinical, id);
      await client.query("delete from ecapital.unit_approver where user_id = $1", [officer.id]);
      await client.query("update ecapital.app_user set is_active = false where id = $1", [officer.id]);
    } finally {
      await client.end();
      await app.close();
    }
  });

  /** ACTIVE in Λευκωσία's office, with the area submitted for acceptance. */
  async function waiting(what: string): Promise<ShutdownPermit> {
    const approved = await approvedPermit(app, {
      titleEl: `${what} ${stamp}`,
      areaIds: [officeArea],
      activityType: "A",
    });
    await client.query(
      `update ecapital.shutdown_permit
          set planned_start = now() - interval '1 hour', planned_end = now() + interval '4 hours'
        where id = $1`,
      [approved.id],
    );
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const active = await request(app.getHttpServer())
      .post(`/permits/${approved.id}/transition`)
      .set(bearer(estates))
      .send({ to: "ACTIVE" });
    expect(active.status).toBe(200);
    const submitted = await request(app.getHttpServer())
      .post(`/permits/${approved.id}/closeout`)
      .set(bearer(estates))
      .send({
        closeout: {
          barriersRemoved: true,
          areaCleaned: true,
          airBalanceRestored: true,
          systemsTestedAndReturned: true,
          fireSystemsReenabled: true,
          noteEl: null,
          clinicalAcceptanceById: null,
          clinicalAcceptanceByName: null,
          clinicalAcceptanceAt: null,
        },
      });
    expect(submitted.status).toBe(200);
    waitingIds.push(approved.id);
    return submitted.body as ShutdownPermit;
  }

  async function offered(token: string, permitId: string) {
    const permit = await request(app.getHttpServer()).get(`/permits/${permitId}`).set(bearer(token));
    const inbox = await request(app.getHttpServer()).get("/inbox").set(bearer(token));
    return {
      mayAccept: (permit.body as ShutdownPermit).handback?.mayAccept ?? false,
      inInbox: (inbox.body as Inbox).items.some((item) => item.href === `/permits/${permitId}` && item.id.startsWith("handback:")),
    };
  }

  function accept(token: string, permitId: string) {
    return request(app.getHttpServer())
      .post(`/permits/${permitId}/transition`)
      .set(bearer(token))
      .send({ to: "CLOSED", commentEl: null });
  }

  it("offers the handback to the unit's Nursing officer while the account holds the role", async () => {
    const permit = await waiting("Αποδοχή από νοσηλευτική");
    const token = await tokenFor(app, officer.email);
    expect(await offered(token, permit.id)).toEqual({ mayAccept: true, inInbox: true });
  });

  it("refuses an account switched off, even with the token it still holds", async () => {
    const permit = await waiting("Αποδοχή από ανενεργό");
    const token = await tokenFor(app, officer.email);
    const off = await request(app.getHttpServer())
      .patch(`/admin/users/${officer.id}`)
      .set(bearer(adminToken))
      .send({ active: false });
    expect(off.status).toBe(200);

    expect(await offered(token, permit.id)).toEqual({ mayAccept: false, inInbox: false });
    const response = await accept(token, permit.id);
    expect(response.status).toBe(403);
    expect(response.body.key).toBe("errors.permitAcceptanceNotYours");
  });

  it("refuses an account that lost the clinical approver role, its scope left in place", async () => {
    const permit = await waiting("Αποδοχή χωρίς ρόλο");
    const stale = await tokenFor(app, officer.email).catch(() => null);
    expect(stale).toBeNull(); // still switched off from the test above
    const back = await request(app.getHttpServer())
      .patch(`/admin/users/${officer.id}`)
      .set(bearer(adminToken))
      .send({ active: true });
    expect(back.status).toBe(200);
    // A token minted while the role is still held, then the role goes.
    const token = await tokenFor(app, officer.email);
    const stripped = await request(app.getHttpServer())
      .patch(`/admin/users/${officer.id}`)
      .set(bearer(adminToken))
      .send({ roles: ["technician"], orgUnitIds: ["nicosia-general"] });
    expect(stripped.status).toBe(200);
    const { rows } = await client.query("select count(*)::int as n from ecapital.unit_approver where user_id = $1", [
      officer.id,
    ]);
    expect(rows[0].n).toBe(1);

    expect(await offered(token, permit.id)).toEqual({ mayAccept: false, inInbox: false });
    const response = await accept(token, permit.id);
    expect(response.status).toBe(403);
    expect(response.body.key).toBe("errors.permitAcceptanceNotYours");

    // Somebody who may still accept it does, so the permit does not linger.
    const clinical = await tokenFor(app, USERS.clinicalNicosia);
    expect((await accept(clinical, permit.id)).status).toBe(200);
  });
});
