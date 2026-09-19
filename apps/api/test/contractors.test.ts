import type { INestApplication } from "@nestjs/common";
import { Contractor } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * R08 — the supplier register. It is shared across the twelve units, so the
 * questions here are who reads it (everybody) and who keeps it (admin and the
 * heads of estates), plus the one field that is an administrator's alone.
 */
describe("/contractors", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function list(email: string): Promise<Contractor[]> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer()).get("/contractors").set(bearer(token));
    expect(response.status).toBe(200);
    return Contractor.array().parse(response.body);
  }

  const body = (name: string) => ({
    name,
    vatNumber: "CY10377777Q",
    registrationNo: "HE 177777",
    category: "MECHANICAL" as const,
    sapVendorId: "V-100777",
  });

  it("shows the whole register to an engineer in one unit", async () => {
    // A contractor is a company, not a hospital's property: the same firm
    // works at Larnaca and at Paphos and the register holds one row for it.
    const seen = await list(USERS.engineerLarnaca);
    expect(seen.length).toBeGreaterThanOrEqual(12);
    expect(seen.some((c) => c.blacklisted)).toBe(true);
    expect(seen.map((c) => c.name)).toContain("Κυριάκου Τεχνικές Κατασκευές Λτδ");
  });

  it("comes back sorted by name and never blacklists on creation", async () => {
    const seen = await list(USERS.admin);
    const names = seen.map((c) => c.name);
    expect([...names].sort((a, b) => a.localeCompare(b, "el"))).toHaveLength(names.length);

    const token = await tokenFor(app, USERS.admin);
    const created = await request(app.getHttpServer())
      .post("/contractors")
      .set(bearer(token))
      .send(body(`Νέος ανάδοχος ${Date.now()}`));
    expect(created.status).toBe(201);
    expect(Contractor.parse(created.body).blacklisted).toBe(false);
  });

  it("lets the head of estates add one and refuses the engineer", async () => {
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const added = await request(app.getHttpServer())
      .post("/contractors")
      .set(bearer(estates))
      .send(body(`Ανάδοχος Λευκωσίας ${Date.now()}`));
    expect(added.status).toBe(201);

    const engineer = await tokenFor(app, USERS.engineerLarnaca);
    const refused = await request(app.getHttpServer())
      .post("/contractors")
      .set(bearer(engineer))
      .send(body(`Ανάδοχος μηχανικού ${Date.now()}`));
    expect(refused.status).toBe(403);
    expect(refused.body.key).toBe("errors.readOnlyAccount");
  });

  it("refuses the auditor and the board, who read everything and write nothing", async () => {
    for (const email of [USERS.auditor, USERS.executive]) {
      const token = await tokenFor(app, email);
      const response = await request(app.getHttpServer())
        .post("/contractors")
        .set(bearer(token))
        .send(body(`Ανάδοχος μόνο ανάγνωσης ${Date.now()}`));
      expect(response.status).toBe(403);
    }
  });

  it("lets only an administrator blacklist a contractor", async () => {
    // RULE (R08): blacklisting stops a firm taking new work across all twelve
    // units, so it is not a unit's decision to make.
    const admin = await tokenFor(app, USERS.admin);
    const created = await request(app.getHttpServer())
      .post("/contractors")
      .set(bearer(admin))
      .send(body(`Υπό έλεγχο ${Date.now()}`));
    const id = created.body.id as string;

    const estates = await tokenFor(app, USERS.estatesNicosia);
    const refused = await request(app.getHttpServer())
      .patch(`/contractors/${id}`)
      .set(bearer(estates))
      .send({ blacklisted: true });
    expect(refused.status).toBe(403);
    expect(refused.body.key).toBe("errors.blacklistAdminOnly");

    // The same head of estates may still correct an ordinary field.
    const corrected = await request(app.getHttpServer())
      .patch(`/contractors/${id}`)
      .set(bearer(estates))
      .send({ vatNumber: "CY10388888R" });
    expect(corrected.status).toBe(200);
    expect(Contractor.parse(corrected.body).vatNumber).toBe("CY10388888R");

    const blacklisted = await request(app.getHttpServer())
      .patch(`/contractors/${id}`)
      .set(bearer(admin))
      .send({ blacklisted: true });
    expect(blacklisted.status).toBe(200);
    expect(Contractor.parse(blacklisted.body).blacklisted).toBe(true);
  });

  it("refuses a second contractor with the same name", async () => {
    const token = await tokenFor(app, USERS.admin);
    const name = `Διπλή επωνυμία ${Date.now()}`;
    const first = await request(app.getHttpServer())
      .post("/contractors")
      .set(bearer(token))
      .send(body(name));
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post("/contractors")
      .set(bearer(token))
      .send(body(name));
    expect(second.status).toBe(422);
    expect(second.body.key).toBe("errors.contractorNameTaken");
  });

  it("refuses a body that is not a contractor, and an id that is not one", async () => {
    const token = await tokenFor(app, USERS.admin);
    const bad = await request(app.getHttpServer())
      .post("/contractors")
      .set(bearer(token))
      .send({ ...body("Χωρίς κατηγορία"), category: "SOMETHING_ELSE" });
    expect(bad.status).toBe(400);
    expect(bad.body.key).toBe("errors.contractorNotValid");

    const missing = await request(app.getHttpServer())
      .patch("/contractors/not-a-uuid")
      .set(bearer(token))
      .send({ vatNumber: "CY1" });
    expect(missing.status).toBe(404);
    expect(missing.body.key).toBe("errors.contractorNotFound");
  });

  it("refuses a caller with no token", async () => {
    const response = await request(app.getHttpServer()).get("/contractors");
    expect(response.status).toBe(401);
  });
});
