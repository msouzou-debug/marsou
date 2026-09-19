import type { INestApplication } from "@nestjs/common";
import {
  ContractDetail,
  Defect,
  DefectBacklogRow,
  ProjectDetail,
} from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract, projectAt } from "./contract-support";

/**
 * R12 and R35 — the defect log, the defects-liability due date, the technician
 * who works the field, and the costed backlog the next capital programme is
 * argued from (CAPEX-01 §2, NHS ERIC).
 */
const inspection = {
  source: "INSPECTION" as const,
  areaId: null,
  descriptionEl: "Σκουριά στη βάση του εφεδρικού ηλεκτροπαραγωγού ζεύγους",
  estimatedCost: 4300,
  riskBand: "SIGNIFICANT" as const,
};

describe("defects", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function post(
    email: string,
    body: Record<string, unknown>,
  ): Promise<request.Response> {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer()).post("/defects").set(bearer(token)).send(body);
  }

  // --------------------------------------------------------------- raising one --

  it("records a defect that belongs only to a unit", async () => {
    // RULE (ADR-0017): no contract, no project — but always a unit.
    const created = await post(USERS.estatesNicosia, {
      ...inspection,
      descriptionEl: `Έλλειψη μονάδας ${Date.now()}`,
      orgUnitId: "nicosia-general",
    });
    expect(created.status).toBe(201);
    const defect = Defect.parse(created.body);
    expect(defect.orgUnitId).toBe("nicosia-general");
    expect(defect.status).toBe("OPEN");
    expect(defect.contractId).toBeNull();
    expect(defect.projectId).toBeNull();
    // No contract means no liability period, so no due date to invent.
    expect(defect.dueDate).toBeNull();
    expect(defect.funded).toBe(false);
    expect(defect.photoIds).toEqual([]);
    expect(defect.raisedByName).toBe("Ανδρέας Παπαδόπουλος");
  });

  it("refuses a defect that names no unit and hangs off nothing", async () => {
    const refused = await post(USERS.estatesNicosia, {
      ...inspection,
      descriptionEl: `Ορφανή έλλειψη ${Date.now()}`,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.key).toBe("errors.defectUnitNeeded");
  });

  it("takes its unit and its project from the contract it is raised on", async () => {
    const { contract, project } = await makeContract(app, `df-ctx-${Date.now()}`);
    const created = await post(USERS.estatesNicosia, {
      ...inspection,
      descriptionEl: `Έλλειψη σύμβασης ${Date.now()}`,
      contractId: contract.id,
    });
    expect(created.status).toBe(201);
    const defect = Defect.parse(created.body);
    expect(defect.orgUnitId).toBe(contract.orgUnitId);
    expect(defect.projectId).toBe(project.id);
  });

  it("works out a handover defect's due date from the contract's dates", async () => {
    // RULE (R12): completion + extensions + defects liability months.
    const { contract } = await makeContract(app, `df-due-${Date.now()}`, {
      completionDate: "2027-06-30",
      defectsLiabilityMonths: 18,
    });
    const created = await post(USERS.estatesNicosia, {
      ...inspection,
      source: "HANDOVER",
      descriptionEl: `Έλλειψη παραλαβής ${Date.now()}`,
      contractId: contract.id,
    });
    expect(created.status).toBe(201);
    expect(Defect.parse(created.body).dueDate).toBe("2028-12-30");

    // An extension moves completion, and the liability period with it.
    const token = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(token))
      .send({ extensionDays: 60 });
    const later = await post(USERS.estatesNicosia, {
      ...inspection,
      source: "HANDOVER",
      descriptionEl: `Έλλειψη παραλαβής με παράταση ${Date.now()}`,
      contractId: contract.id,
    });
    expect(Defect.parse(later.body).dueDate).toBe("2029-02-28");
  });

  it("gives no due date to a defect that is not a handover defect", async () => {
    const { contract } = await makeContract(app, `df-nodue-${Date.now()}`);
    const created = await post(USERS.estatesNicosia, {
      ...inspection,
      descriptionEl: `Έλλειψη επιθεώρησης σε σύμβαση ${Date.now()}`,
      contractId: contract.id,
    });
    expect(Defect.parse(created.body).dueDate).toBeNull();
  });

  // ------------------------------------------------------------ the field persona --

  it("lets a technician raise an inspection defect and refuses them a handover one", async () => {
    // RULE (ADR-0017, CAPEX-01 §2 §8): the technician works what they find on
    // a round or on a work order. A handover defect is a contractual position
    // on somebody else's work and stays with the people who run the contract.
    const allowed = await post(USERS.technicianNicosia, {
      ...inspection,
      descriptionEl: `Έλλειψη τεχνικού ${Date.now()}`,
      orgUnitId: "nicosia-general",
    });
    expect(allowed.status).toBe(201);
    expect(Defect.parse(allowed.body).raisedByName).toBe("Κυριάκος Στυλιανού");

    const workOrder = await post(USERS.technicianNicosia, {
      ...inspection,
      source: "WORK_ORDER",
      descriptionEl: `Έλλειψη εντολής εργασίας ${Date.now()}`,
      orgUnitId: "nicosia-general",
    });
    expect(workOrder.status).toBe(201);

    const refused = await post(USERS.technicianNicosia, {
      ...inspection,
      source: "HANDOVER",
      descriptionEl: `Έλλειψη παραλαβής από τεχνικό ${Date.now()}`,
      orgUnitId: "nicosia-general",
    });
    expect(refused.status).toBe(403);
    expect(refused.body.key).toBe("errors.readOnlyAccount");

    // A condition survey is not theirs either — it is an estates exercise.
    const survey = await post(USERS.technicianNicosia, {
      ...inspection,
      source: "CONDITION_SURVEY",
      descriptionEl: `Έλλειψη αποτύπωσης ${Date.now()}`,
      orgUnitId: "nicosia-general",
    });
    expect(survey.status).toBe(403);
  });

  it("lets a technician work the defect they raised", async () => {
    const created = await post(USERS.technicianNicosia, {
      ...inspection,
      descriptionEl: `Έλλειψη προς εργασία ${Date.now()}`,
      orgUnitId: "nicosia-general",
    });
    const token = await tokenFor(app, USERS.technicianNicosia);
    const worked = await request(app.getHttpServer())
      .patch(`/defects/${created.body.id}`)
      .set(bearer(token))
      .send({ status: "IN_PROGRESS" });
    expect(worked.status).toBe(200);
    expect(Defect.parse(worked.body).status).toBe("IN_PROGRESS");
  });

  // ------------------------------------------------------------- changing one --

  it("records who closed it and when, and clears both on reopening", async () => {
    const created = await post(USERS.estatesNicosia, {
      ...inspection,
      descriptionEl: `Έλλειψη προς κλείσιμο ${Date.now()}`,
      orgUnitId: "nicosia-general",
    });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const closed = await request(app.getHttpServer())
      .patch(`/defects/${created.body.id}`)
      .set(bearer(token))
      .send({ status: "CLOSED" });
    expect(closed.status).toBe(200);
    const after = Defect.parse(closed.body);
    expect(after.closedAt).not.toBeNull();
    expect(after.closedByName).toBe("Ανδρέας Παπαδόπουλος");

    const reopened = await request(app.getHttpServer())
      .patch(`/defects/${created.body.id}`)
      .set(bearer(token))
      .send({ status: "OPEN" });
    const back = Defect.parse(reopened.body);
    expect(back.closedAt).toBeNull();
    expect(back.closedById).toBeNull();
  });

  it("refuses funded with nothing to fund it from, and allows it with a project", async () => {
    // RULE (R35): funded means a capital project is paying.
    const created = await post(USERS.estatesNicosia, {
      ...inspection,
      descriptionEl: `Έλλειψη χρηματοδότησης ${Date.now()}`,
      orgUnitId: "nicosia-general",
    });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const refused = await request(app.getHttpServer())
      .patch(`/defects/${created.body.id}`)
      .set(bearer(token))
      .send({ funded: true });
    expect(refused.status).toBe(422);
    expect(refused.body.key).toBe("errors.fundedNeedsProject");

    const project = await projectAt(app, "APPROVED", `Έργο κάλυψης ${Date.now()}`);
    const allowed = await request(app.getHttpServer())
      .patch(`/defects/${created.body.id}`)
      .set(bearer(token))
      .send({ funded: true, targetProjectId: project.id });
    expect(allowed.status).toBe(200);
    expect(Defect.parse(allowed.body).targetProjectId).toBe(project.id);

    // And taking the project away again while it is still funded is refused.
    const stripped = await request(app.getHttpServer())
      .patch(`/defects/${created.body.id}`)
      .set(bearer(token))
      .send({ targetProjectId: null });
    expect(stripped.status).toBe(422);
    expect(stripped.body.key).toBe("errors.fundedNeedsProject");
  });

  // ---------------------------------------------------------------- the lists --

  it("filters by unit, contract, status, band and source", async () => {
    const stamp = Date.now();
    const { contract } = await makeContract(app, `df-filter-${stamp}`);
    await post(USERS.estatesNicosia, {
      ...inspection,
      source: "HANDOVER",
      riskBand: "HIGH",
      descriptionEl: `Έλλειψη φίλτρου Α ${stamp}`,
      contractId: contract.id,
    });
    await post(USERS.estatesNicosia, {
      ...inspection,
      riskBand: "LOW",
      descriptionEl: `Έλλειψη φίλτρου Β ${stamp}`,
      contractId: contract.id,
    });
    const token = await tokenFor(app, USERS.estatesNicosia);

    const all = await request(app.getHttpServer())
      .get(`/defects?contract=${contract.id}`)
      .set(bearer(token));
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(2);

    const high = await request(app.getHttpServer())
      .get(`/defects?contract=${contract.id}&riskBand=HIGH`)
      .set(bearer(token));
    expect(high.body).toHaveLength(1);
    expect(Defect.parse(high.body[0]).source).toBe("HANDOVER");

    const handover = await request(app.getHttpServer())
      .get(`/defects?contract=${contract.id}&source=HANDOVER&status=OPEN`)
      .set(bearer(token));
    expect(handover.body).toHaveLength(1);

    const elsewhere = await request(app.getHttpServer())
      .get(`/defects?contract=${contract.id}&unit=larnaca-general`)
      .set(bearer(token));
    expect(elsewhere.body).toHaveLength(0);
  });

  it("shows them on the contract and counts them on the project", async () => {
    const stamp = Date.now();
    const { contract, project } = await makeContract(app, `df-detail-${stamp}`);
    await post(USERS.estatesNicosia, {
      ...inspection,
      descriptionEl: `Έλλειψη οθόνης σύμβασης ${stamp}`,
      contractId: contract.id,
    });
    const token = await tokenFor(app, USERS.estatesNicosia);

    const detail = await request(app.getHttpServer())
      .get(`/contracts/${contract.id}`)
      .set(bearer(token));
    expect(ContractDetail.parse(detail.body).defects).toHaveLength(1);

    const projectDetail = await request(app.getHttpServer())
      .get(`/projects/${project.id}`)
      .set(bearer(token));
    expect(ProjectDetail.parse(projectDetail.body).openDefects).toBe(1);
  });

  it("adds the backlog up to the defects that are still open", async () => {
    // R35: one row per unit per band, over OPEN and IN_PROGRESS.
    const token = await tokenFor(app, USERS.estatesNicosia);
    const [open, backlog] = await Promise.all([
      request(app.getHttpServer())
        .get("/defects?unit=nicosia-general&status=OPEN&status=IN_PROGRESS")
        .set(bearer(token)),
      request(app.getHttpServer())
        .get("/defects/backlog?unit=nicosia-general")
        .set(bearer(token)),
    ]);
    expect(backlog.status).toBe(200);
    const rows = backlog.body.map((row: unknown) => DefectBacklogRow.parse(row));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.reduce((sum: number, r: DefectBacklogRow) => sum + r.count, 0)).toBe(
      open.body.length,
    );
    for (const row of rows) {
      expect(row.orgUnitId).toBe("nicosia-general");
      // Funded plus unfunded is the whole cost of the band, always.
      expect(row.funded + row.unfunded).toBeCloseTo(row.estimatedCost, 2);
    }
  });

  it("bands the seeded handover backlog across all four risk levels", async () => {
    // CAPEX-01 §15: the seed has to give every screen something to show.
    const token = await tokenFor(app, USERS.admin);
    const seeded = await request(app.getHttpServer())
      .get("/defects?source=HANDOVER")
      .set(bearer(token));
    const bands = new Set(seeded.body.map((d: Defect) => d.riskBand));
    expect([...bands].sort()).toEqual(["HIGH", "LOW", "MODERATE", "SIGNIFICANT"]);
    expect(seeded.body.length).toBeGreaterThanOrEqual(12);
    expect(seeded.body.some((d: Defect) => d.funded && d.targetProjectId !== null)).toBe(true);
  });

  // ------------------------------------------------------------------- access --

  it("hides another unit's defects behind a 404 and out of the list", async () => {
    const created = await post(USERS.estatesNicosia, {
      ...inspection,
      descriptionEl: `Έλλειψη Λευκωσίας ${Date.now()}`,
      orgUnitId: "nicosia-general",
    });
    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    const seen = await request(app.getHttpServer())
      .get(`/defects/${created.body.id}`)
      .set(bearer(larnaca));
    expect(seen.status).toBe(404);
    expect(seen.body.key).toBe("errors.defectNotFound");

    const list = await request(app.getHttpServer()).get("/defects").set(bearer(larnaca));
    expect(list.body.some((d: Defect) => d.id === created.body.id)).toBe(false);
    expect(list.body.every((d: Defect) => d.orgUnitId === "larnaca-general")).toBe(true);
  });

  it("refuses a defect in a unit the caller may write nowhere near", async () => {
    // The Larnaca engineer may write at Larnaca and nowhere else.
    const refused = await post(USERS.engineerLarnaca, {
      ...inspection,
      descriptionEl: `Έλλειψη εκτός μονάδας ${Date.now()}`,
      orgUnitId: "nicosia-general",
    });
    expect(refused.status).toBe(403);
  });

  it("refuses the auditor and the executive a write and lets them read", async () => {
    for (const email of [USERS.auditor, USERS.executive]) {
      const token = await tokenFor(app, email);
      const read = await request(app.getHttpServer()).get("/defects").set(bearer(token));
      expect(read.status).toBe(200);
      const refused = await post(email, {
        ...inspection,
        descriptionEl: `Έλλειψη μόνο για ανάγνωση ${Date.now()}`,
        orgUnitId: "nicosia-general",
      });
      expect(refused.status).toBe(403);
      expect(refused.body.key).toBe("errors.readOnlyAccount");
    }
  });

  it("writes an audit row with the actor for every defect mutation", async () => {
    // R42.
    const created = await post(USERS.technicianNicosia, {
      ...inspection,
      descriptionEl: `Έλλειψη με ιστορικό ${Date.now()}`,
      orgUnitId: "nicosia-general",
    });
    const token = await tokenFor(app, USERS.technicianNicosia);
    await request(app.getHttpServer())
      .patch(`/defects/${created.body.id}`)
      .set(bearer(token))
      .send({ status: "IN_PROGRESS" });

    const auditor = await tokenFor(app, USERS.auditor);
    const log = await request(app.getHttpServer())
      .get("/audit-log")
      .query({ entity_type: "defect", entity_id: created.body.id })
      .set(bearer(auditor));
    expect(log.status).toBe(200);
    expect(log.body.map((e: { action: string }) => e.action).sort()).toEqual([
      "INSERT",
      "UPDATE",
    ]);
    for (const entry of log.body) {
      expect(entry.actorId).toBe("dev-technician-nicosia");
      expect(entry.orgUnitId).toBe("nicosia-general");
    }
  });
});
