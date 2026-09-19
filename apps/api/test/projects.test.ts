import type { INestApplication } from "@nestjs/common";
import { ProjectDetail, ProjectList } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * The M1 register end to end: who sees which projects, what the list does
 * with filters and a Greek search box, and what a create and a change leave
 * behind in the audit log (R04, R05, R07, R42).
 *
 * Nothing here asks a service for permission. The row policies decide, and
 * these tests prove it by asking as five different people.
 */
describe("GET /projects", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function list(email: string, query = ""): Promise<ProjectList> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer())
      .get(`/projects${query}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    return ProjectList.parse(response.body);
  }

  it("gives the administrator all forty-three seeded projects", async () => {
    const page = await list(USERS.admin, "?pageSize=200");
    // Other suites add projects to the same cluster, so count the seeded ones
    // rather than everything: only the seed carries a source row reference.
    // 43, not 42, since owner decision 19/09/2026 added HQ's own project.
    expect(page.items.filter((p) => p.sourceRowRef !== null)).toHaveLength(43);
  });

  it("gives the Larnaca engineer only Larnaca", async () => {
    const page = await list(USERS.engineerLarnaca, "?pageSize=200");
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((p) => p.orgUnitId === "larnaca-general")).toBe(true);
  });

  it("answers 404 when the Larnaca engineer opens a Nicosia project", async () => {
    // Not 403. Under the policy the row does not exist for this caller, so
    // the honest answer is the one a misspelt id gets — a 403 would confirm
    // the project exists, which is what they must not learn (CAPEX-01 §10).
    const nicosia = await list(USERS.admin, "?unit=nicosia-general&pageSize=1");
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .get(`/projects/${nicosia.items[0].id}`)
      .set(bearer(token));
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.projectNotFound");
  });

  it("shows HQ's own project to the administrator and hides it from a Nicosia estates head", async () => {
    // Owner decision, 19/09/2026: HQ is a unit like any other now, so its one
    // project follows the same row-level rule every other unit's does.
    const admin = await list(USERS.admin, "?unit=hq&pageSize=10");
    expect(admin.items).toHaveLength(1);
    const hqProject = admin.items[0];
    expect(hqProject.titleEl).toBe("Αναβάθμιση δικτύου δεδομένων Κεντρικών Γραφείων");
    expect(hqProject.orgUnitId).toBe("hq");

    const nicosiaEstates = await tokenFor(app, USERS.estatesNicosia);
    const direct = await request(app.getHttpServer())
      .get(`/projects/${hqProject.id}`)
      .set(bearer(nicosiaEstates));
    expect(direct.status).toBe(404);
    expect(direct.body.key).toBe("errors.projectNotFound");

    const listedForNicosia = await list(USERS.estatesNicosia, "?pageSize=200");
    expect(listedForNicosia.items.some((p) => p.id === hqProject.id)).toBe(false);
  });

  it("matches «ΑΝΑΚΑΙΝΙΣΗ» against «Ανακαίνιση χειρουργείων»", async () => {
    // Case and accents both folded, in the database, by the same function
    // that backs the index.
    const page = await list(USERS.admin, "?q=ΑΝΑΚΑΙΝΙΣΗ&pageSize=200");
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.some((p) => p.titleEl === "Ανακαίνιση χειρουργείων")).toBe(true);
    expect(page.items.every((p) => p.titleEl.toLowerCase().includes("ανακαίν"))).toBe(true);
  });

  it("matches a code as well as a title", async () => {
    const all = await list(USERS.admin, "?pageSize=1");
    const code = all.items[0].code;
    const page = await list(USERS.admin, `?q=${encodeURIComponent(code)}`);
    expect(page.items.map((p) => p.code)).toContain(code);
  });

  it("filters by phase and by rag, repeating the parameter for several", async () => {
    const page = await list(USERS.admin, "?phase=IDEA&phase=PREPARATION&pageSize=200");
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((p) => p.phase === "IDEA" || p.phase === "PREPARATION")).toBe(true);

    const red = await list(USERS.admin, "?rag=RED&pageSize=200");
    expect(red.items.every((p) => p.rag === "RED")).toBe(true);
  });

  it("sorts and pages", async () => {
    const page = await list(USERS.admin, "?sort=approvedBudget&dir=desc&pageSize=5&page=1");
    expect(page.items).toHaveLength(5);
    expect(page.pageSize).toBe(5);
    const budgets = page.items.map((p) => p.approvedBudget);
    expect([...budgets].sort((a, b) => b - a)).toEqual(budgets);

    const second = await list(USERS.admin, "?sort=approvedBudget&dir=desc&pageSize=5&page=2");
    expect(second.page).toBe(2);
    expect(second.items.map((p) => p.id)).not.toEqual(page.items.map((p) => p.id));
    expect(second.total).toBe(page.total);
  });

  it("refuses a page size nobody could want", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get("/projects?pageSize=5000")
      .set(bearer(token));
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.projectQueryNotValid");
  });

  it("keeps the four ledgers apart and leaves the two it does not know null", async () => {
    // CAPEX-01 §7: a ledger the system has not been told is null, never zero.
    // M1 knows two of them — the approved budget from the day the project is
    // opened, and the commitment once a contract exists (R13).
    const page = await list(USERS.admin, "?pageSize=200");
    expect(page.items[0].ledgers.approved).toBe(page.items[0].approvedBudget);
    expect(page.items.every((p) => p.ledgers.spent === null)).toBe(true);
    expect(page.items.every((p) => p.ledgers.forecast === null)).toBe(true);

    // A project before award has no contract and therefore no commitment.
    const early = page.items.find((p) => p.phase === "IDEA");
    expect(early?.ledgers.committed).toBeNull();
    // One that has been awarded has one, and it is a figure, not a zero.
    const awarded = page.items.find((p) => p.phase === "IN_PROGRESS" && p.sourceRowRef !== null);
    expect(awarded?.ledgers.committed).toBeGreaterThan(0);
  });

  it("refuses a caller with no token", async () => {
    const response = await request(app.getHttpServer()).get("/projects");
    expect(response.status).toBe(401);
  });
});

describe("GET /projects/:id", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("carries the unit, the names, the children and the history", async () => {
    const token = await tokenFor(app, USERS.admin);
    const list = await request(app.getHttpServer())
      .get("/projects?unit=nicosia-general&pageSize=200")
      .set(bearer(token));
    const seeded = ProjectList.parse(list.body).items.filter((p) => p.sourceRowRef !== null);
    const withChildren = seeded.find((p) => p.phase !== "IDEA") ?? seeded[0];

    const response = await request(app.getHttpServer())
      .get(`/projects/${withChildren.id}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    const detail = ProjectDetail.parse(response.body);

    expect(detail.orgUnit.id).toBe("nicosia-general");
    expect(detail.orgUnit.nameEl).toBe("Γενικό Νοσοκομείο Λευκωσίας");
    // The Nicosia projects are sponsored by the head of estates there.
    expect(detail.sponsorName).toBe("Ανδρέας Παπαδόπουλος");
    expect(detail.milestones.length).toBeGreaterThanOrEqual(2);
    expect(detail.milestones.map((m) => m.sortOrder)).toEqual(
      [...detail.milestones.map((m) => m.sortOrder)].sort((a, b) => a - b),
    );
    expect(detail.milestones.some((m) => m.isGate)).toBe(true);
    expect(detail.audit.length).toBeGreaterThan(0);
  });

  it("answers 404 for an id that is not a project at all", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get("/projects/not-a-uuid")
      .set(bearer(token));
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.projectNotFound");
  });

  it("lets the project engineer read the history of their own project", async () => {
    // GET /audit-log is the auditor's document and stays closed to everyone
    // else; a project's own trail belongs on the project page (ADR-0014).
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const list = await request(app.getHttpServer()).get("/projects?pageSize=1").set(bearer(token));
    const id = ProjectList.parse(list.body).items[0].id;
    const response = await request(app.getHttpServer())
      .get(`/projects/${id}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    expect(ProjectDetail.parse(response.body).audit.length).toBeGreaterThan(0);

    const log = await request(app.getHttpServer()).get("/audit-log").set(bearer(token));
    expect(log.status).toBe(403);
  });
});

describe("POST /projects and PATCH /projects/:id", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const body = (titleEl: string) => ({
    orgUnitId: "nicosia-general",
    titleEl,
    titleEn: null,
    category: "RENOVATION" as const,
    approvedBudget: 250_000,
    fundingSource: "STATE_BUDGET" as const,
    plannedStart: "2027-01-11",
    plannedFinish: "2027-11-30",
    budgetYearFrom: 2027,
    budgetYearTo: 2027,
    sapWbs: null,
    tenderReference: null,
    sponsorId: null,
    projectManagerId: null,
  });

  it("gives the head of estates at Nicosia the next NGH code of the year", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post("/projects")
      .set(bearer(token))
      .send(body(`Αντικατάσταση στέγης ${Date.now()}`));

    expect(response.status).toBe(201);
    const detail = ProjectDetail.parse(response.body);
    const year = new Date().getUTCFullYear();
    expect(detail.code).toMatch(new RegExp(`^NGH-${year}-\\d{3}$`));
    expect(detail.phase).toBe("IDEA");
    expect(detail.approvedBudget).toBe(250_000);

    // R42: the create wrote its own audit line, with the right actor.
    expect(detail.audit).toHaveLength(1);
    expect(detail.audit[0].action).toBe("created");
    expect(detail.audit[0].actorName).toBe("Ανδρέας Παπαδόπουλος");
  });

  it("hands two engineers pressing the button together two different codes", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const stamp = Date.now();
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post("/projects")
        .set(bearer(token))
        .send(body(`Ταυτόχρονο έργο Α ${stamp}`)),
      request(app.getHttpServer())
        .post("/projects")
        .set(bearer(token))
        .send(body(`Ταυτόχρονο έργο Β ${stamp}`)),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.code).not.toBe(second.body.code);
  });

  it("refuses a body that is not a project", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post("/projects")
      .set(bearer(token))
      .send({ ...body("Χωρίς κατηγορία"), category: "SOMETHING_ELSE" });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.projectNotValid");
  });

  it("changes only the fields the patch names, and says so in the audit line", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const created = await request(app.getHttpServer())
      .post("/projects")
      .set(bearer(token))
      .send(body(`Αναβάθμιση λεβητοστασίου ${Date.now()}`));
    const id = created.body.id as string;

    const response = await request(app.getHttpServer())
      .patch(`/projects/${id}`)
      .set(bearer(token))
      .send({ approvedBudget: 310_000 });
    expect(response.status).toBe(200);
    const detail = ProjectDetail.parse(response.body);
    expect(detail.approvedBudget).toBe(310_000);
    expect(detail.titleEl).toBe(created.body.titleEl);
    expect(detail.audit[0].action).toBe("updated");
    expect(detail.audit[0].detail).toContain("approvedBudget");
  });

  it("refuses the engineer who is not in the unit", async () => {
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .post("/projects")
      .set(bearer(token))
      .send(body(`Έργο εκτός μονάδας ${Date.now()}`));
    expect(response.status).toBe(403);
    expect(response.body.key).toBe("errors.readOnlyAccount");
  });

  it("refuses the clinical approver, who reads the register and does not run it", async () => {
    // can_read_unit says yes and can_manage_project says no: CAPEX-01 §10
    // gives the register to admin, the head of estates and the engineers.
    const token = await tokenFor(app, USERS.clinicalNicosia);
    const response = await request(app.getHttpServer())
      .post("/projects")
      .set(bearer(token))
      .send(body(`Κλινικό αίτημα ${Date.now()}`));
    expect(response.status).toBe(403);
  });
});
