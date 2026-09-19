import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPENAPI_PATH, generate } from "../scripts/generate-openapi";

/**
 * CAPEX-01 §3 wants the OpenAPI document checked in, and a checked-in
 * document that no longer matches the code is worse than none: somebody
 * builds against it. So the build fails instead.
 */
describe("openapi.json", () => {
  it("matches the controllers", async () => {
    const generated = await generate();
    const checkedIn = readFileSync(OPENAPI_PATH, "utf8");
    expect(
      checkedIn,
      "openapi.json is stale — run: pnpm --filter @ecapital/api openapi",
    ).toBe(generated);
  });

  it("is OpenAPI 3.1 and covers every M0 and M1 route", async () => {
    const document = JSON.parse(readFileSync(OPENAPI_PATH, "utf8"));
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).sort()).toEqual([
      "/admin/roles",
      "/admin/users",
      "/admin/users/{id}",
      "/audit-log",
      "/auth/dev-token",
      "/auth/login",
      "/config/links",
      "/contractors",
      "/contractors/{id}",
      "/contracts",
      "/contracts/lookup",
      "/contracts/{id}",
      "/contracts/{id}/boq",
      "/contracts/{id}/rfis",
      "/contracts/{id}/rfis/{rid}/answer",
      "/contracts/{id}/rfis/{rid}/close",
      "/contracts/{id}/site-instructions",
      "/contracts/{id}/site-instructions/{sid}/variation",
      "/contracts/{id}/variations",
      "/contracts/{id}/variations/{vid}",
      "/contracts/{id}/variations/{vid}/decide",
      "/contracts/{id}/variations/{vid}/submit",
      "/defects",
      "/defects/backlog",
      "/defects/{id}",
      "/health",
      "/me",
      "/org-units",
      "/org-units/{id}/areas",
      "/portfolio",
      "/projects",
      "/projects/{id}",
      "/projects/{id}/contracts",
      "/projects/{id}/issues",
      "/projects/{id}/issues/{iid}",
      "/projects/{id}/milestones",
      "/projects/{id}/milestones/{mid}",
      "/projects/{id}/phase",
      "/projects/{id}/risks",
      "/projects/{id}/risks/{rid}",
    ]);
  });
});
