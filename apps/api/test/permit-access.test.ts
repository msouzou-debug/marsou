import type { INestApplication } from "@nestjs/common";
import type { PermitListRow, ShutdownPermit } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import {
  M3_USERS,
  approveEveryLine,
  draftPermit,
  nicosiaAreas,
  runIcra,
  submit,
  type AreaIds,
} from "./permit-support";

/**
 * CAPEX-01 §9 and §10 — who sees a permit and who may change it.
 *
 * «Clinical approvers see only permits touching their areas and nothing
 * else.» That is the narrowest access rule in the system and the one most
 * worth breaking by accident, so it is checked from both ends: a permit the
 * approver is on, and a permit they are not.
 *
 * Enforced twice — a SQL policy in migration 0015 and a service check on the
 * decision — and both are exercised here through HTTP with the seeded
 * accounts, which is the only way to know the two agree.
 */
describe("who sees a permit (§9)", () => {
  let app: INestApplication;
  let areas: AreaIds;
  let stamp = 0;

  beforeAll(async () => {
    app = await createTestApp();
    areas = await nicosiaAreas(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const title = (what: string) => `${what} ${Date.now()}-${(stamp += 1)}`;

  async function listFor(email: string, query = ""): Promise<PermitListRow[]> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer())
      .get(`/permits?pageSize=100${query}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    return response.body.items as PermitListRow[];
  }

  async function getAs(email: string, id: string) {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer()).get(`/permits/${id}`).set(bearer(token));
  }

  it("shows a clinical approver a permit with a line assigned to them", async () => {
    // The theatre pulls in Infection Control (Class IV) and the ward manager,
    // both of which resolve to clinical.nicosia.
    const permit = await draftPermit(app, {
      titleEl: title("Με γραμμή για τον εγκριτή"),
      areaIds: [areas.theatre],
    });
    await runIcra(app, permit.id, "C");
    await submit(app, permit.id);

    const seen = await getAs(USERS.clinicalNicosia, permit.id);
    expect(seen.status).toBe(200);
    expect((seen.body as ShutdownPermit).id).toBe(permit.id);
  });

  it("shows a clinical approver a permit that only touches an area they own", async () => {
    // A draft, so there are no approval lines at all — the only way in is
    // through area_clinical_owner on the theatre.
    const permit = await draftPermit(app, {
      titleEl: title("Πρόχειρο στο χειρουργείο"),
      areaIds: [areas.theatre],
    });
    const seen = await getAs(USERS.clinicalNicosia, permit.id);
    expect(seen.status).toBe(200);
  });

  it("hides from a clinical approver a permit in their unit that is none of their business", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Γραφείο χωρίς κλινικό ενδιαφέρον"),
      areaIds: [areas.office],
    });
    const hidden = await getAs(USERS.clinicalNicosia, permit.id);
    expect(hidden.status).toBe(404);
    expect(hidden.body.key).toBe("errors.permitNotFound");

    const list = await listFor(USERS.clinicalNicosia);
    expect(list.map((row) => row.id)).not.toContain(permit.id);
  });

  it("gives the Nursing officer the ward permits and not the office ones", async () => {
    const ward = await draftPermit(app, {
      titleEl: title("Θάλαμος για τη Νοσηλευτική"),
      areaIds: [areas.ward],
    });
    await runIcra(app, ward.id, "B");
    await submit(app, ward.id);
    const office = await draftPermit(app, {
      titleEl: title("Γραφείο για κανέναν"),
      areaIds: [areas.office],
    });

    expect((await getAs(M3_USERS.nursingNicosia, ward.id)).status).toBe(200);
    expect((await getAs(M3_USERS.nursingNicosia, office.id)).status).toBe(404);
  });

  it("gives every other unit role the whole unit, as usual", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Για όλη τη μονάδα"),
      areaIds: [areas.office],
    });
    for (const email of [USERS.estatesNicosia, USERS.technicianNicosia, USERS.finance]) {
      expect((await getAs(email, permit.id)).status).toBe(200);
    }
  });

  it("gives the auditor and the executive everything, read-only", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Για τον ελεγκτή"),
      areaIds: [areas.office],
    });
    for (const email of [USERS.auditor, USERS.executive]) {
      expect((await getAs(email, permit.id)).status).toBe(200);
      const token = await tokenFor(app, email);
      const write = await request(app.getHttpServer())
        .patch(`/permits/${permit.id}`)
        .set(bearer(token))
        .send({ titleEl: "Μια αλλαγή" });
      expect(write.status).toBe(403);
    }
  });

  it("shows a unit's permits to nobody in another unit", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Λευκωσία μόνο"),
      areaIds: [areas.office],
    });
    expect((await getAs(USERS.engineerLarnaca, permit.id)).status).toBe(404);
    const list = await listFor(USERS.engineerLarnaca);
    expect(list.every((row) => row.orgUnitId === "larnaca-general")).toBe(true);
  });

  it("lets an approver decide their own line and nobody else's", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Δικές μου γραμμές"),
      areaIds: [areas.theatre, areas.ward],
    });
    await runIcra(app, permit.id, "C");
    const submitted = await submit(app, permit.id);

    const ward = submitted.approvals.find(
      (line) => line.role === "WARD_MANAGER" && line.areaId === areas.theatre,
    );
    const nursing = submitted.approvals.find((line) => line.role === "NURSING");
    expect(ward?.approverName).toBe("Γιώργος Σάββα");
    expect(nursing?.approverName).toBe("Μαρίνα Αντωνίου");

    const clinical = await tokenFor(app, USERS.clinicalNicosia);
    // Their own: allowed.
    const mine = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/approvals/${ward?.id}/decide`)
      .set(bearer(clinical))
      .send({ decision: "APPROVED", commentEl: null });
    expect(mine.status).toBe(200);

    // The Nursing officer's: refused, although they can see the permit.
    const notMine = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/approvals/${nursing?.id}/decide`)
      .set(bearer(clinical))
      .send({ decision: "APPROVED", commentEl: null });
    expect(notMine.status).toBe(403);
    expect(notMine.body.key).toBe("errors.permitDecisionNotYours");
  });

  it("refuses a clinical approver who tries to edit the request itself", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Ο εγκριτής δεν γράφει"),
      areaIds: [areas.theatre],
    });
    const token = await tokenFor(app, USERS.clinicalNicosia);
    const response = await request(app.getHttpServer())
      .patch(`/permits/${permit.id}`)
      .set(bearer(token))
      .send({ titleEl: "Αλλαγμένο" });
    expect(response.status).toBe(403);
  });

  it("refuses a clinical approver raising a shutdown of their own", async () => {
    const token = await tokenFor(app, USERS.clinicalNicosia);
    const response = await request(app.getHttpServer())
      .post("/permits")
      .set(bearer(token))
      .send({
        titleEl: title("Από τον εγκριτή"),
        descriptionEl: "",
        workKind: "MAINTENANCE",
        systems: ["WATER"],
        affectedAreaIds: [areas.theatre],
        plannedStart: new Date(Date.now() + 86_400_000).toISOString(),
        plannedEnd: new Date(Date.now() + 90_000_000).toISOString(),
        contingencyPlanEl: null,
        ilsmTriggers: [],
      });
    expect(response.status).toBe(403);
  });

  it("keeps the clinical approver's audit trail as narrow as their permits", async () => {
    // GET /audit-log stays admin and auditor only (ADR-0014); the permit
    // policy adds nothing for a clinical approver, whose §9 scope is narrower
    // than the unit.
    const token = await tokenFor(app, USERS.clinicalNicosia);
    const response = await request(app.getHttpServer())
      .get("/audit-log?entityType=shutdown_permit")
      .set(bearer(token));
    expect(response.status).toBe(403);
  });

  it("lets an administrator decide a line nobody was resolved for", async () => {
    // Larnaca has no INFECTION_CONTROL appointment, so a Class III+ permit
    // there routes to a line with no approver. It blocks — which is the
    // strict reading — and an administrator can clear it.
    const admin = await tokenFor(app, USERS.admin);
    const larnaca = await request(app.getHttpServer())
      .get("/org-units/larnaca-general/areas")
      .set(bearer(admin));
    const theatre = larnaca.body.buildings
      .flatMap((b: { floors: { areas: { code: string; id: string }[] }[] }) => b.floors)
      .flatMap((f: { areas: { code: string; id: string }[] }) => f.areas)
      .find((a: { code: string }) => a.code === "THE-01");

    const draft = await draftPermit(app, {
      titleEl: title("Λάρνακα χωρίς Επιτροπή"),
      areaIds: [theatre.id],
      email: USERS.engineerLarnaca,
    });
    await runIcra(app, draft.id, "C", USERS.engineerLarnaca);
    const submitted = await submit(app, draft.id, USERS.engineerLarnaca);
    const unassigned = submitted.approvals.find((line) => line.role === "INFECTION_CONTROL");
    // Nobody holds Infection Control at Λάρνακα yet, so the line has no
    // approver and blocks the permit — the strict reading, on purpose.
    expect(unassigned?.approverId).toBeNull();
    expect(submitted.status).toBe("CLINICAL_REVIEW");

    const permit = await approveEveryLine(app, draft.id);
    expect(permit.status).toBe("APPROVED");
    const ic = permit.approvals.find((line) => line.role === "INFECTION_CONTROL");
    // An administrator deciding on nobody's behalf is recorded as the person
    // who decided, which is what the audit trail has to be able to say.
    expect(ic?.approverName).toBe("Μαρία Κωνσταντίνου");
    expect(ic?.decision).toBe("APPROVED");
  });
});
