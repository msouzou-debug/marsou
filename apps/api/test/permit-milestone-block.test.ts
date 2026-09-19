import type { INestApplication } from "@nestjs/common";
import type { Milestone, ProjectDetail, ShutdownPermit } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { projectAt } from "./contract-support";
import { draftPermit, nicosiaAreas, runIcra, submit, type AreaIds } from "./permit-support";

/**
 * R24, CAPEX-01 §6.6 — «No closeout, no permit closure, and an open permit
 * blocks the project milestone.»
 *
 * The second half is the one that bites: a project cannot record a milestone
 * as done while a shutdown on it is still open, because the barriers are up
 * and the theatre is down.
 */
describe("an open permit blocks a milestone (R24)", () => {
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

  const label = (what: string) => `${what} ${Date.now()}-${(stamp += 1)}`;

  async function projectWithMilestone(): Promise<{ project: ProjectDetail; milestone: Milestone }> {
    const project = await projectAt(app, "IN_PROGRESS", label("Έργο με ορόσημο"));
    const token = await tokenFor(app, USERS.admin);
    const created = await request(app.getHttpServer())
      .post(`/projects/${project.id}/milestones`)
      .set(bearer(token))
      .send({
        titleEl: "Ολοκλήρωση ηλεκτρολογικών",
        baselineDate: "2027-06-30",
        forecastDate: "2027-06-30",
        actualDate: null,
        isGate: false,
        sortOrder: 900,
      });
    expect(created.status).toBe(201);
    return { project, milestone: created.body as Milestone };
  }

  async function permitOn(projectId: string, target: "DRAFT" | "SUBMITTED"): Promise<ShutdownPermit> {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const draft = await draftPermit(app, {
      titleEl: label("Διακοπή του έργου"),
      areaIds: [areas.office],
    });
    const linked = await request(app.getHttpServer())
      .patch(`/permits/${draft.id}`)
      .set(bearer(token))
      .send({ projectId });
    expect(linked.status).toBe(200);
    if (target === "DRAFT") return linked.body as ShutdownPermit;
    await runIcra(app, draft.id, "A");
    return submit(app, draft.id);
  }

  async function complete(projectId: string, milestone: Milestone) {
    const token = await tokenFor(app, USERS.admin);
    return request(app.getHttpServer())
      .patch(`/projects/${projectId}/milestones/${milestone.id}`)
      .set(bearer(token))
      .send({
        titleEl: milestone.titleEl,
        baselineDate: milestone.baselineDate,
        forecastDate: milestone.forecastDate,
        actualDate: "2027-06-28",
        isGate: milestone.isGate,
        sortOrder: 900,
      });
  }

  it("refuses the completion with 409 and names the permit", async () => {
    const { project, milestone } = await projectWithMilestone();
    const permit = await permitOn(project.id, "SUBMITTED");

    const response = await complete(project.id, milestone);
    expect(response.status).toBe(409);
    expect(response.body.key).toBe("errors.openPermitBlocksMilestone");
    expect(response.body.message).toContain(permit.ref as string);
  });

  it("lets the completion through once the permit is rejected", async () => {
    const { project, milestone } = await projectWithMilestone();
    const permit = await permitOn(project.id, "SUBMITTED");
    expect((await complete(project.id, milestone)).status).toBe(409);

    const token = await tokenFor(app, USERS.admin);
    const rejected = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({ to: "REJECTED", commentEl: "Ακυρώθηκε η εργασία." });
    expect(rejected.status).toBe(200);

    const after = await complete(project.id, milestone);
    expect(after.status).toBe(200);
    expect((after.body as Milestone).actualDate).toBe("2027-06-28");
  });

  it("lets a draft permit through — nobody has asked for anything yet", async () => {
    const { project, milestone } = await projectWithMilestone();
    await permitOn(project.id, "DRAFT");
    const response = await complete(project.id, milestone);
    expect(response.status).toBe(200);
  });

  it("does not block an edit to a milestone that was already complete", async () => {
    const { project, milestone } = await projectWithMilestone();
    const done = await complete(project.id, milestone);
    expect(done.status).toBe(200);

    await permitOn(project.id, "SUBMITTED");

    const token = await tokenFor(app, USERS.admin);
    const renamed = await request(app.getHttpServer())
      .patch(`/projects/${project.id}/milestones/${milestone.id}`)
      .set(bearer(token))
      .send({
        titleEl: "Ολοκλήρωση ηλεκτρολογικών εργασιών",
        baselineDate: milestone.baselineDate,
        forecastDate: milestone.forecastDate,
        actualDate: "2027-06-28",
        isGate: milestone.isGate,
        sortOrder: 900,
      });
    expect(renamed.status).toBe(200);
  });

  it("does not block a project that has no permit at all", async () => {
    const { project, milestone } = await projectWithMilestone();
    expect((await complete(project.id, milestone)).status).toBe(200);
  });
});
