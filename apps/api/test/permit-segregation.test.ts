import type { INestApplication } from "@nestjs/common";
import { ApproverScopes } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { M3_USERS, draftPermit, runIcra, submit } from "./permit-support";

/**
 * ADR-0015's segregation of duties, applied to the M3 route (ADR-0026,
 * 19/09/2026): a permit's own requester never resolves as one of its own
 * approvers, and never decides one of its own lines either — an
 * administrator standing in for a missing approver included.
 *
 * Λάρνακα is the exact case the fix was found from: before it, the unit's
 * only TECHNICAL appointment was the engineer who raised most of its
 * shutdowns, so submitting her own permit resolved TECHNICAL to herself,
 * with live decide buttons on her own record. The seed now appoints the
 * Larnaca estates head instead; these tests make her the requester so the
 * same collision is exercised on purpose.
 */
const ESTATES_LARNACA = "estates.larnaca@ecapital.test";
describe("segregation of duties on the permit route", () => {
  let app: INestApplication;
  let adminToken: string;
  let larnacaPlantAreaId: string;
  let stamp = 0;

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await tokenFor(app, USERS.admin);
    const larnaca = await request(app.getHttpServer())
      .get("/org-units/larnaca-general/areas")
      .set(bearer(adminToken));
    const found = (
      larnaca.body.buildings as { floors: { areas: { code: string; id: string }[] }[] }[]
    )
      .flatMap((b) => b.floors)
      .flatMap((f) => f.areas)
      .find((a) => a.code === "PLT-01");
    if (!found) throw new Error("no seeded Larnaca area PLT-01");
    larnacaPlantAreaId = found.id;
  });
  afterAll(async () => {
    await app.close();
  });

  const title = (what: string) => `${what} ${Date.now()}-${(stamp += 1)}`;

  async function userId(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .get(`/admin/users?q=${encodeURIComponent(email)}&pageSize=10`)
      .set(bearer(adminToken));
    const match = (response.body.items as { id: string; email: string }[]).find(
      (u) => u.email === email,
    );
    if (!match) throw new Error(`no admin/users match for ${email}`);
    return match.id;
  }

  async function scopesOf(id: string): Promise<ApproverScopes> {
    const response = await request(app.getHttpServer())
      .get(`/admin/users/${id}/approver-scopes`)
      .set(bearer(adminToken));
    return ApproverScopes.parse(response.body);
  }

  async function putScopes(id: string, scopes: ApproverScopes): Promise<void> {
    const response = await request(app.getHttpServer())
      .put(`/admin/users/${id}/approver-scopes`)
      .set(bearer(adminToken))
      .send(scopes);
    if (response.status !== 200) {
      throw new Error(`putScopes: ${response.status} ${JSON.stringify(response.body)}`);
    }
  }

  it("prefers another TECHNICAL holder in the unit over the permit's own requester", async () => {
    const nursingId = await userId(M3_USERS.nursingNicosia);
    const before = await scopesOf(nursingId);
    await putScopes(nursingId, {
      areas: before.areas,
      units: [...before.units, { orgUnitId: "larnaca-general", role: "TECHNICAL" }],
    });
    try {
      const draft = await draftPermit(app, {
        titleEl: title("Λάρνακα με δεύτερο τεχνικό"),
        areaIds: [larnacaPlantAreaId],
        email: ESTATES_LARNACA,
      });
      await runIcra(app, draft.id, "A", ESTATES_LARNACA);
      const submitted = await submit(app, draft.id, ESTATES_LARNACA);
      const technical = submitted.approvals.find((line) => line.role === "TECHNICAL");
      expect(technical?.approverId).not.toBe(submitted.requestedById);
      expect(technical?.approverId).toBe(nursingId);
      expect(technical?.decision).toBe("PENDING");
    } finally {
      await putScopes(nursingId, before);
    }
  });

  it("leaves the line unassigned rather than resolve it to the requester, when nobody else holds the role", async () => {
    const draft = await draftPermit(app, {
      titleEl: title("Λάρνακα χωρίς άλλον τεχνικό"),
      areaIds: [larnacaPlantAreaId],
      email: ESTATES_LARNACA,
    });
    await runIcra(app, draft.id, "A", ESTATES_LARNACA);
    const submitted = await submit(app, draft.id, ESTATES_LARNACA);
    const technical = submitted.approvals.find((line) => line.role === "TECHNICAL");
    // The seed's only TECHNICAL appointment at Λάρνακα is the requester
    // herself here, so the line blocks — the strict reading — rather than
    // resolving to her.
    expect(technical?.approverId).toBeNull();
    expect(technical?.decision).toBe("PENDING");
    expect(submitted.status).toBe("CLINICAL_REVIEW");
  });

  it("refuses 409 when the caller is the permit's own requester, even standing in as an administrator", async () => {
    // Raised by an administrator, not by the Larnaca estates head — so
    // TECHNICAL resolves normally to her, with nothing left unassigned. This isolates
    // the second guard, in `decide()`, from the first one (in routing,
    // exercised above): an administrator's own bypass for a line nobody
    // else could be resolved for must not become a way to decide her own
    // permit's lines, resolved or not.
    const draft = await draftPermit(app, {
      titleEl: title("Λάρνακα αυτοέγκριση διοίκησης"),
      areaIds: [larnacaPlantAreaId],
      email: USERS.admin,
    });
    await runIcra(app, draft.id, "A", USERS.admin);
    const submitted = await submit(app, draft.id, USERS.admin);
    const technical = submitted.approvals.find((line) => line.role === "TECHNICAL");
    expect(technical?.approverId).not.toBeNull();
    expect(technical?.approverId).not.toBe(submitted.requestedById);

    // Without the guard, the admin bypass in `decide()` would let her clear
    // a line on her own permit that somebody else was resolved for.
    const response = await request(app.getHttpServer())
      .post(`/permits/${draft.id}/approvals/${technical?.id}/decide`)
      .set(bearer(adminToken))
      .send({ decision: "APPROVED", commentEl: null });
    expect(response.status).toBe(409);
    expect(response.body.key).toBe("errors.permitSelfApproval");
  });
});
