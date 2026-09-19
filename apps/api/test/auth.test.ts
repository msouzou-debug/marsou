import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, forgedToken, tokenFor } from "./app";

/** R01, and the failure path §15 asks for on every endpoint. */
describe("authentication", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("refuses a request with no token", async () => {
    const response = await request(app.getHttpServer()).get("/me");
    expect(response.status).toBe(401);
    expect(response.body.key).toBe("errors.notSignedIn");
  });

  it("refuses a token signed with the wrong key", async () => {
    const response = await request(app.getHttpServer())
      .get("/me")
      .set(bearer(await forgedToken()));
    expect(response.status).toBe(401);
  });

  it("refuses a bearer header that is not a token", async () => {
    const response = await request(app.getHttpServer()).get("/me").set(bearer("not-a-jwt"));
    expect(response.status).toBe(401);
  });

  it("answers /me with the caller's roles and org units", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer()).get("/me").set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      sub: "dev-estates-nicosia",
      email: USERS.estatesNicosia,
      roles: ["estates_head"],
      orgUnitIds: ["nicosia-general"],
    });
  });

  it("gives a central administration user every unit id", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/me").set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body.orgUnitIds).toHaveLength(11);
  });

  it("mints a development token for a seeded user and refuses an unknown one", async () => {
    const ok = await request(app.getHttpServer())
      .post("/auth/dev-token")
      .send({ email: USERS.auditor });
    expect(ok.status).toBe(201);
    expect(ok.body.claims.roles).toEqual(["auditor_readonly"]);

    const missing = await request(app.getHttpServer())
      .post("/auth/dev-token")
      .send({ email: "nobody@ecapital.test" });
    expect(missing.status).toBe(404);
    expect(missing.body.key).toBe("errors.userNotFound");
  });
});

/** R43 and R46: the error body is Greek unless the caller asks for English. */
describe("error messages", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("answers in Greek by default", async () => {
    const response = await request(app.getHttpServer()).get("/me");
    expect(response.body.message).toBe(
      "Δεν είστε συνδεδεμένοι. Συνδεθείτε ξανά και επαναλάβετε την ενέργεια.",
    );
  });

  it("answers in English when Accept-Language asks", async () => {
    const response = await request(app.getHttpServer())
      .get("/me")
      .set("Accept-Language", "en-GB,en;q=0.9");
    expect(response.body.message).toBe(
      "You are not signed in. Sign in again and repeat what you were doing.",
    );
  });

  it("falls back to Greek for a language we do not have", async () => {
    const response = await request(app.getHttpServer()).get("/me").set("Accept-Language", "fr-FR");
    expect(response.body.message).toContain("Δεν είστε συνδεδεμένοι");
  });

  it("never puts a code in the sentence", async () => {
    const response = await request(app.getHttpServer()).get("/me");
    expect(response.body.message).not.toMatch(/\d{3}/);
    expect(response.body.message).not.toContain("errors.");
    // The key is there for the client, just not in the sentence.
    expect(response.body.key).toBe("errors.notSignedIn");
  });
});
