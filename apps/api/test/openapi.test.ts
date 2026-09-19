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

  it("is OpenAPI 3.1 and covers every M0, M1, M2, M3 and M8 route", async () => {
    const document = JSON.parse(readFileSync(OPENAPI_PATH, "utf8"));
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths).sort()).toEqual([
      "/admin/dms/outbox",
      "/admin/dms/outbox/{id}/retry",
      "/admin/roles",
      "/admin/users",
      "/admin/users/{id}",
      "/admin/users/{id}/approver-scopes",
      "/api/v1/dms/events",
      "/areas/impact",
      "/audit-log",
      "/auth/dev-token",
      "/auth/login",
      "/budget-codes",
      "/budget-codes/sync",
      "/calendar",
      "/calendar/disruption-hours",
      "/config/links",
      "/contractors",
      "/contractors/{id}",
      "/contracts",
      "/contracts/lookup",
      "/contracts/{id}",
      "/contracts/{id}/boq",
      "/contracts/{id}/documents",
      "/contracts/{id}/payment-certs",
      "/contracts/{id}/rfis",
      "/contracts/{id}/rfis/{rid}/answer",
      "/contracts/{id}/rfis/{rid}/close",
      "/contracts/{id}/site-instructions",
      "/contracts/{id}/site-instructions/{sid}/variation",
      "/contracts/{id}/variations",
      "/contracts/{id}/variations/{vid}",
      "/contracts/{id}/variations/{vid}/decide",
      "/contracts/{id}/variations/{vid}/submit",
      "/cost/accruals",
      "/cost/accruals/export",
      "/cost/imports",
      "/cost/imports/{id}",
      "/cost/imports/{id}/allocate",
      "/cost/imports/{id}/commit",
      "/cost/imports/{id}/skip",
      "/cost/imports/{id}/unmatched",
      "/defects",
      "/defects/backlog",
      "/defects/{id}",
      "/health",
      "/icra/evaluate",
      "/icra/matrix",
      "/icra/matrix/versions",
      "/icra/matrix/versions/{id}/activate",
      "/inbox",
      "/inbox/{id}/read",
      "/me",
      "/org-units",
      "/org-units/{id}/areas",
      "/org-units/{id}/cost/cashflow",
      "/payment-certs/{id}",
      "/payment-certs/{id}/transition",
      "/permits",
      "/permits/{id}",
      "/permits/{id}/approvals/{approvalId}/decide",
      "/permits/{id}/audit",
      "/permits/{id}/icra",
      "/permits/{id}/transition",
      "/portfolio",
      "/projects",
      "/projects/{id}",
      "/projects/{id}/budget-lines",
      "/projects/{id}/contracts",
      "/projects/{id}/cost",
      "/projects/{id}/cost/cashflow",
      "/projects/{id}/cost/export",
      "/projects/{id}/cost/forecast-inputs",
      "/projects/{id}/cost/warnings/{wid}/dismiss",
      "/projects/{id}/documents",
      "/projects/{id}/issues",
      "/projects/{id}/issues/{iid}",
      "/projects/{id}/milestones",
      "/projects/{id}/milestones/{mid}",
      "/projects/{id}/phase",
      "/projects/{id}/risks",
      "/projects/{id}/risks/{rid}",
      "/system-feeds",
      "/system-feeds/{id}",
      "/variations/{id}/documents",
    ]);
  });
});
