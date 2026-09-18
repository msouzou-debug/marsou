import type { INestApplication } from "@nestjs/common";
import { Issue, Milestone, ProjectDetail, Risk } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * R06 and R07 — milestones, risks and issues on a project, and the one rule
 * that makes the milestone table worth keeping: the baseline does not move.
 */
describe("project milestones, risks and issues", () => {
  let app: INestApplication;
  let projectId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const token = await tokenFor(app, USERS.estatesNicosia);
    const created = await request(app.getHttpServer())
      .post("/projects")
      .set(bearer(token))
      .send({
        orgUnitId: "nicosia-general",
        titleEl: `Έργο παιδιών ${Date.now()}`,
        titleEn: null,
        category: "EQUIPMENT",
        approvedBudget: 120_000,
        fundingSource: "OWN",
        plannedStart: "2027-03-01",
        plannedFinish: "2027-12-01",
        budgetYearFrom: 2027,
        budgetYearTo: 2027,
        sapWbs: null,
        tenderReference: null,
        sponsorId: null,
        projectManagerId: null,
      });
    expect(created.status).toBe(201);
    projectId = created.body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  const milestone = {
    titleEl: "Παράδοση εξοπλισμού",
    baselineDate: "2027-06-30",
    forecastDate: "2027-06-30",
    actualDate: null,
    isGate: false,
    sortOrder: 2,
  };

  it("adds a milestone and records it on the timeline", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/milestones`)
      .set(bearer(token))
      .send(milestone);
    expect(response.status).toBe(201);
    const stored = Milestone.parse(response.body);
    expect(stored.baselineDate).toBe("2027-06-30");

    const detail = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set(bearer(token));
    const parsed = ProjectDetail.parse(detail.body);
    expect(parsed.audit[0].action).toBe("milestoneAdded");
    expect(parsed.audit[0].detail).toBe("Παράδοση εξοπλισμού");
    expect(parsed.audit[0].actorName).toBe("Ανδρέας Παπαδόπουλος");
  });

  it("moves the forecast freely and refuses to move the baseline", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const created = await request(app.getHttpServer())
      .post(`/projects/${projectId}/milestones`)
      .set(bearer(token))
      .send({ ...milestone, titleEl: "Εγκατάσταση", sortOrder: 3 });
    const id = created.body.id as string;

    const moved = await request(app.getHttpServer())
      .patch(`/projects/${projectId}/milestones/${id}`)
      .set(bearer(token))
      .send({ ...milestone, titleEl: "Εγκατάσταση", forecastDate: "2027-08-15", sortOrder: 3 });
    expect(moved.status).toBe(200);
    expect(Milestone.parse(moved.body).forecastDate).toBe("2027-08-15");

    // R06: the baseline is the promise the project was approved on.
    const refused = await request(app.getHttpServer())
      .patch(`/projects/${projectId}/milestones/${id}`)
      .set(bearer(token))
      .send({ ...milestone, titleEl: "Εγκατάσταση", baselineDate: "2027-09-30", sortOrder: 3 });
    expect(refused.status).toBe(422);
    expect(refused.body.key).toBe("errors.baselineFixed");
  });

  it("refuses a milestone with no baseline date", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/milestones`)
      .set(bearer(token))
      .send({ titleEl: "Χωρίς ημερομηνία", isGate: false });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.milestoneNotValid");
  });

  it("adds a risk with its owner's name resolved", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/risks`)
      .set(bearer(token))
      .send({
        descriptionEl: "Καθυστέρηση παράδοσης από τον προμηθευτή",
        likelihood: 4,
        impact: 3,
        status: "OPEN",
      });
    expect(response.status).toBe(201);
    expect(Risk.parse(response.body).likelihood).toBe(4);

    const detail = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set(bearer(token));
    expect(ProjectDetail.parse(detail.body).audit[0].action).toBe("riskAdded");
  });

  it("refuses a risk scored outside one to five", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/risks`)
      .set(bearer(token))
      .send({ descriptionEl: "Υπερβολικός κίνδυνος", likelihood: 9, impact: 3 });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.riskNotValid");
  });

  it("raises an issue in the caller's own name, never in a name the body asks for", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/issues`)
      .set(bearer(token))
      .send({
        descriptionEl: "Δεν έχει οριστεί χώρος προσωρινής αποθήκευσης",
        dueDate: "2027-05-01",
        status: "OPEN",
        // Ignored: the contract keeps raisedBy out of IssueWrite on purpose.
        raisedById: "00000000-0000-0000-0000-000000000000",
      });
    expect(response.status).toBe(201);
    Issue.parse(response.body);

    const detail = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set(bearer(token));
    const parsed = ProjectDetail.parse(detail.body);
    const raised = parsed.issues.find((i) => i.descriptionEl.startsWith("Δεν έχει οριστεί"));
    expect(raised?.raisedByName).toBe("Ανδρέας Παπαδόπουλος");
  });

  it("refuses an issue with no description", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/projects/${projectId}/issues`)
      .set(bearer(token))
      .send({ dueDate: "2027-05-01" });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.issueNotValid");
  });

  it("refuses the auditor and the executive every kind of write", async () => {
    const writes: [string, string, Record<string, unknown>][] = [
      ["patch", `/projects/${projectId}`, { approvedBudget: 1 }],
      ["post", `/projects/${projectId}/milestones`, milestone],
      ["post", `/projects/${projectId}/risks`, { descriptionEl: "Δοκιμή", likelihood: 1, impact: 1 }],
      ["post", `/projects/${projectId}/issues`, { descriptionEl: "Δοκιμή" }],
    ];
    for (const email of [USERS.auditor, USERS.executive]) {
      const token = await tokenFor(app, email);
      for (const [method, path, body] of writes) {
        const agent = request(app.getHttpServer());
        const response = await (method === "patch" ? agent.patch(path) : agent.post(path))
          .set(bearer(token))
          .send(body);
        expect(response.status).toBe(403);
        expect(response.body.key).toBe("errors.readOnlyAccount");
      }
    }
  });

  it("answers 404 for a milestone that belongs to another project", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .patch(`/projects/${projectId}/milestones/00000000-0000-0000-0000-000000000000`)
      .set(bearer(token))
      .send(milestone);
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.milestoneNotFound");
  });
});
