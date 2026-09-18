import type { INestApplication } from "@nestjs/common";
import { ProjectDetail } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * R04 — the phase rule, which is the one business rule in M1 that refuses
 * things: one step, forwards, with a reason, and not past a gate that nobody
 * has ticked. The exception is an administrator, who may move a project back
 * because going back is a decision somebody takes, not a typo to correct.
 */
describe("POST /projects/:id/phase", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function newProject(email = USERS.estatesNicosia): Promise<ProjectDetail> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer())
      .post("/projects")
      .set(bearer(token))
      .send({
        orgUnitId: "nicosia-general",
        titleEl: `Έργο σταδίων ${Math.random().toString(36).slice(2, 10)}`,
        titleEn: null,
        category: "SMALL_WORKS",
        approvedBudget: 90_000,
        fundingSource: "STATE_BUDGET",
        plannedStart: "2027-02-01",
        plannedFinish: "2027-09-30",
        budgetYearFrom: 2027,
        budgetYearTo: 2027,
        sapWbs: null,
        tenderReference: null,
        sponsorId: null,
        projectManagerId: null,
      });
    expect(response.status).toBe(201);
    return ProjectDetail.parse(response.body);
  }

  async function move(email: string, id: string, phase: string, reasonEl: string) {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer())
      .post(`/projects/${id}/phase`)
      .set(bearer(token))
      .send({ phase, reasonEl });
  }

  it("moves one step forward and records the reason on the timeline", async () => {
    const project = await newProject();
    const response = await move(
      USERS.estatesNicosia,
      project.id,
      "PREPARATION",
      "Εγκρίθηκε η προκαταρκτική μελέτη",
    );
    expect(response.status).toBe(200);
    const detail = ProjectDetail.parse(response.body);
    expect(detail.phase).toBe("PREPARATION");
    expect(detail.audit[0].action).toBe("phaseChanged");
    expect(detail.audit[0].detail).toBe(
      "IDEA → PREPARATION: Εγκρίθηκε η προκαταρκτική μελέτη",
    );
    expect(detail.audit[0].actorName).toBe("Ανδρέας Παπαδόπουλος");
  });

  it("refuses a jump over a phase", async () => {
    const project = await newProject();
    const response = await move(USERS.estatesNicosia, project.id, "APPROVED", "Βιάζομαι");
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.phaseNotNext");
  });

  it("refuses a step backwards from anyone but an administrator", async () => {
    const project = await newProject();
    expect(
      (await move(USERS.estatesNicosia, project.id, "PREPARATION", "Προχωρά")).status,
    ).toBe(200);
    const response = await move(
      USERS.estatesNicosia,
      project.id,
      "IDEA",
      "Θέλω να το γυρίσω πίσω",
    );
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.phaseNotNext");
  });

  it("lets an administrator move a project back, recorded the same way", async () => {
    const project = await newProject();
    expect(
      (await move(USERS.estatesNicosia, project.id, "PREPARATION", "Προχωρά")).status,
    ).toBe(200);
    const response = await move(
      USERS.admin,
      project.id,
      "IDEA",
      "Ανακλήθηκε η έγκριση από τη Διεύθυνση",
    );
    expect(response.status).toBe(200);
    const detail = ProjectDetail.parse(response.body);
    expect(detail.phase).toBe("IDEA");
    expect(detail.audit[0].action).toBe("phaseChanged");
    expect(detail.audit[0].detail).toBe(
      "PREPARATION → IDEA: Ανακλήθηκε η έγκριση από τη Διεύθυνση",
    );
  });

  it("refuses the move while a gate milestone of the current phase is open", async () => {
    const project = await newProject();
    const token = await tokenFor(app, USERS.estatesNicosia);
    const gate = await request(app.getHttpServer())
      .post(`/projects/${project.id}/milestones`)
      .set(bearer(token))
      .send({
        titleEl: "Έγκριση ιδέας",
        baselineDate: "2027-01-15",
        forecastDate: "2027-01-15",
        actualDate: null,
        isGate: true,
        sortOrder: 1,
      });
    expect(gate.status).toBe(201);

    const refused = await move(USERS.estatesNicosia, project.id, "PREPARATION", "Προχωρά");
    expect(refused.status).toBe(422);
    expect(refused.body.key).toBe("errors.gateOpen");
    expect(refused.body.message).toContain("Έγκριση ιδέας");

    // Tick the gate and the same move goes through.
    const ticked = await request(app.getHttpServer())
      .patch(`/projects/${project.id}/milestones/${gate.body.id}`)
      .set(bearer(token))
      .send({
        titleEl: "Έγκριση ιδέας",
        baselineDate: "2027-01-15",
        forecastDate: "2027-01-20",
        actualDate: "2027-01-20",
        isGate: true,
        sortOrder: 1,
      });
    expect(ticked.status).toBe(200);
    expect((await move(USERS.estatesNicosia, project.id, "PREPARATION", "Προχωρά")).status).toBe(
      200,
    );
  });

  it("refuses a phase change with no reason", async () => {
    const project = await newProject();
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/projects/${project.id}/phase`)
      .set(bearer(token))
      .send({ phase: "PREPARATION", reasonEl: "" });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.phaseChangeNotValid");
  });

  it("refuses the auditor and the executive, who read and never write", async () => {
    const project = await newProject();
    for (const email of [USERS.auditor, USERS.executive]) {
      const response = await move(email, project.id, "PREPARATION", "Δοκιμή");
      expect(response.status).toBe(403);
      expect(response.body.key).toBe("errors.readOnlyAccount");
    }
  });
});
