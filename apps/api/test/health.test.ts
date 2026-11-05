import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp } from "./app";
import { readMigrations } from "../src/db/migrate";

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
      // Whatever the newest migration on disk is: an operator reads this to
      // tell whether a deploy finished, so it has to track the files rather
      // than a version somebody pinned in a test (ADR-0008).
      lastMigrationId: readMigrations().at(-1)?.id,
    });
    expect(response.body.at).toMatch(/Z$/);
  });

  it("carries the framing and sniffing headers, like every answer", async () => {
    // Clickjacking finding of 05/11/2026 against the estate: an eCapital
    // page must not load inside somebody else's frame.
    const response = await request(app.getHttpServer()).get("/health");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    const missing = await request(app.getHttpServer()).get("/no-such-route");
    expect(missing.status).toBe(404);
    expect(missing.headers["x-frame-options"]).toBe("DENY");
  });

  it("says nothing about the data", async () => {
    const response = await request(app.getHttpServer()).get("/health");
    expect(Object.keys(response.body).sort()).toEqual(["at", "db", "lastMigrationId", "status"]);
  });
});
