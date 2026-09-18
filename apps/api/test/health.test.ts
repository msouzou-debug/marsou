import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./app";

describe("GET /health", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("reports the database and the applied migration, with no token", async () => {
    const response = await request(app.getHttpServer()).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      db: true,
      lastMigrationId: "0001_m0_foundations",
    });
    expect(response.body.at).toMatch(/Z$/);
  });

  it("says nothing about the data", async () => {
    const response = await request(app.getHttpServer()).get("/health");
    expect(Object.keys(response.body).sort()).toEqual(["at", "db", "lastMigrationId", "status"]);
  });
});
