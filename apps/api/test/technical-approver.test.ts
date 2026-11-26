import type { INestApplication } from "@nestjs/common";
import { ApproverScopes, Inbox, type ShutdownPermit } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { draftPermit, runIcra, submit } from "./permit-support";

/**
 * ADR-0039 (owner decision 26/11/2026): the technical and safety approver.
 *
 * A role of its own for the TECHNICAL and SAFETY lines, so estates staff are
 * not given clinical approval rights to decide them. The seed appoints
 * technical.larnaca to both lines at Λάρνακα, after the estates head, so a
 * permit the estates head raises herself routes TECHNICAL to him, and SAFETY
 * goes to him always.
 */
const TECHNICAL_LARNACA = "technical.larnaca@ecapital.test";
const ESTATES_LARNACA = "estates.larnaca@ecapital.test";

describe("the technical and safety approver (ADR-0039)", () => {
  let app: INestApplication;
  let client: Client;
  let adminToken: string;
  let plantAreaId: string;
  let opdAreaId: string;
  let stamp = 0;

  beforeAll(async () => {
    app = await createTestApp();
    client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
    adminToken = await tokenFor(app, USERS.admin);
    const larnaca = await request(app.getHttpServer())
      .get("/org-units/larnaca-general/areas")
      .set(bearer(adminToken));
    const areas = (larnaca.body.buildings as { floors: { areas: { code: string; id: string }[] }[] }[])
      .flatMap((b) => b.floors)
      .flatMap((f) => f.areas);
    plantAreaId = areas.find((a) => a.code === "PLT-01")!.id;
    opdAreaId = areas.find((a) => a.code === "OPD-01")!.id;
  });
  afterAll(async () => {
    await client.end();
    await app.close();
  });

  const title = (what: string) => `${what} ${Date.now()}-${(stamp += 1)}`;

  async function userId(email: string): Promise<string> {
    const { rows } = await client.query("select id from ecapital.app_user where email = $1", [email]);
    return rows[0].id as string;
  }

  async function scopes(id: string, body?: ApproverScopes) {
    const call = body
      ? request(app.getHttpServer()).put(`/admin/users/${id}/approver-scopes`).send(body)
      : request(app.getHttpServer()).get(`/admin/users/${id}/approver-scopes`);
    return call.set(bearer(adminToken));
  }

  async function decide(email: string, permit: ShutdownPermit, lineId: string, decision: "APPROVED" | "RETURNED") {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer())
      .post(`/permits/${permit.id}/approvals/${lineId}/decide`)
      .set(bearer(token))
      .send({ decision, commentEl: decision === "APPROVED" ? null : "Λείπει το σχέδιο απομόνωσης." });
  }

  async function inboxFor(email: string): Promise<Inbox> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer()).get("/inbox").set(bearer(token));
    expect(response.status).toBe(200);
    return Inbox.parse(response.body);
  }

  it("signs in with the new role, the technical row at APPROVE and the clinical one at READ", async () => {
    const token = await tokenFor(app, TECHNICAL_LARNACA);
    const me = await request(app.getHttpServer()).get("/me").set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.roles).toEqual(["technical_approver"]);
    expect(me.body.permissions.permitTechnical).toBe("APPROVE");
    expect(me.body.permissions.permitClinical).toBe("READ");
    expect(me.body.permissions.permitOperate).toBe("READ");
    expect(me.body.permissions.permitRequest).toBe("READ");
  });

  it("is listed in the role catalogue as a unit role, right after the clinical approver", async () => {
    const response = await request(app.getHttpServer()).get("/admin/roles").set(bearer(adminToken));
    const roles = (response.body as { role: string; scope: string }[]).map((entry) => entry.role);
    expect(roles.indexOf("technical_approver")).toBe(roles.indexOf("clinical_approver") + 1);
    expect(response.body).toContainEqual({ role: "technical_approver", scope: "unit" });
  });

  it("decides the TECHNICAL and SAFETY lines the routing gives him", async () => {
    const technicalId = await userId(TECHNICAL_LARNACA);
    const draft = await draftPermit(app, {
      titleEl: title("Πυρανίχνευση μηχανοστασίου Λάρνακας"),
      areaIds: [plantAreaId],
      ilsmTriggers: ["FIRE_DETECTION"],
      email: ESTATES_LARNACA,
    });
    await runIcra(app, draft.id, "A", ESTATES_LARNACA);
    const submitted = await submit(app, draft.id, ESTATES_LARNACA);
    const technical = submitted.approvals.find((line) => line.role === "TECHNICAL")!;
    const safety = submitted.approvals.find((line) => line.role === "SAFETY")!;
    // The estates head raised it, so her own TECHNICAL appointment is passed
    // over for the next holder in the unit (ADR-0026).
    expect(technical.approverId).toBe(technicalId);
    expect(safety.approverId).toBe(technicalId);

    const inbox = await inboxFor(TECHNICAL_LARNACA);
    for (const line of [technical, safety]) {
      expect(inbox.items.find((item) => item.id === line.id)?.decidable).toBe(true);
    }

    const approved = await decide(TECHNICAL_LARNACA, submitted, technical.id, "APPROVED");
    expect(approved.status).toBe(200);
    const returned = await decide(TECHNICAL_LARNACA, submitted, safety.id, "RETURNED");
    expect(returned.status).toBe(200);
  });

  it("may not decide a clinical line, even one assigned to him", async () => {
    const technicalId = await userId(TECHNICAL_LARNACA);
    const draft = await draftPermit(app, {
      titleEl: title("Λάρνακα, εξωτερικά ιατρεία"),
      areaIds: [opdAreaId],
      email: USERS.engineerLarnaca,
    });
    await runIcra(app, draft.id, "D", USERS.engineerLarnaca);
    const submitted = await submit(app, draft.id, USERS.engineerLarnaca);
    const clinical = submitted.approvals.find((line) =>
      ["INFECTION_CONTROL", "WARD_MANAGER", "NURSING", "HOSPITAL_DIRECTOR"].includes(line.role),
    );
    expect(clinical).toBeDefined();
    // Written around the scope screen on purpose, which refuses this
    // appointment: the decide route is the second lock and is tested alone.
    await client.query("update ecapital.permit_approval set approver_id = $1 where id = $2", [
      technicalId,
      clinical!.id,
    ]);

    const inbox = await inboxFor(TECHNICAL_LARNACA);
    expect(inbox.items.find((item) => item.id === clinical!.id)?.decidable).toBe(false);
    const response = await decide(TECHNICAL_LARNACA, submitted, clinical!.id, "APPROVED");
    expect(response.status).toBe(403);
    expect(response.body.key).toBe("errors.permitDecisionRoleMissing");
  });

  describe("the scopes the administrator may give", () => {
    it("takes TECHNICAL and SAFETY on the new role", async () => {
      const id = await userId(TECHNICAL_LARNACA);
      const before = ApproverScopes.parse((await scopes(id)).body);
      expect(before.units).toEqual(
        expect.arrayContaining([
          { orgUnitId: "larnaca-general", role: "TECHNICAL" },
          { orgUnitId: "larnaca-general", role: "SAFETY" },
        ]),
      );
      const again = await scopes(id, before);
      expect(again.status).toBe(200);
    });

    it("refuses a clinical scope on the new role, by unit or by area, with the clinical sentence", async () => {
      const id = await userId(TECHNICAL_LARNACA);
      const before = ApproverScopes.parse((await scopes(id)).body);
      const director = await scopes(id, {
        areas: [],
        units: [...before.units, { orgUnitId: "larnaca-general", role: "HOSPITAL_DIRECTOR" }],
      });
      expect(director.status).toBe(422);
      expect(director.body.key).toBe("errors.approverScopesNeedRole");
      const ward = await scopes(id, { areas: [{ areaId: opdAreaId, role: "WARD_MANAGER" }], units: [] });
      expect(ward.status).toBe(422);
      expect(ward.body.key).toBe("errors.approverScopesNeedRole");
      // Nothing was half-applied.
      expect(ApproverScopes.parse((await scopes(id)).body)).toEqual(before);
    });

    it("refuses TECHNICAL to a role that may not decide it, with its own sentence", async () => {
      const id = await userId(USERS.technicianNicosia);
      const response = await scopes(id, {
        areas: [],
        units: [{ orgUnitId: "nicosia-general", role: "TECHNICAL" }],
      });
      expect(response.status).toBe(422);
      expect(response.body.key).toBe("errors.approverScopesNeedTechnicalRole");
    });

    it("takes TECHNICAL and SAFETY on the estates head, as the seed appoints them", async () => {
      const id = await userId(USERS.estatesNicosia);
      const before = ApproverScopes.parse((await scopes(id)).body);
      expect(before.units).toContainEqual({ orgUnitId: "nicosia-general", role: "SAFETY" });
      const again = await scopes(id, before);
      expect(again.status).toBe(200);
      const nursing = await scopes(id, {
        areas: [],
        units: [...before.units, { orgUnitId: "nicosia-general", role: "NURSING" }],
      });
      expect(nursing.status).toBe(422);
      expect(nursing.body.key).toBe("errors.approverScopesNeedRole");
    });

    it("keeps a clinical approver's TECHNICAL appointment, as on the live server", async () => {
      const id = await userId("director.nicosia@ecapital.test");
      const before = ApproverScopes.parse((await scopes(id)).body);
      const widened = await scopes(id, {
        areas: before.areas,
        units: [...before.units, { orgUnitId: "nicosia-general", role: "TECHNICAL" }],
      });
      expect(widened.status).toBe(200);
      expect((await scopes(id, before)).status).toBe(200);
    });
  });
});
