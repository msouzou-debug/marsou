import type { INestApplication } from "@nestjs/common";
import { BudgetCodeList, BudgetCodeSyncResult, ContractDetail } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { contractBody, makeContract, makeContractor, projectAt } from "./contract-support";

/**
 * ADR-0025, owner decision 19/09/2026: one CAPEX budget code per contract,
 * chosen from `GET /budget-codes?kind=capex`. `POST /budget-codes/sync`
 * falls back to eCapital's own seed list in every test environment, because
 * neither EFINANCE_URL nor EFINANCE_TOKEN is configured for the test app
 * (config-boot.test.ts covers the two failing to boot together correctly;
 * this suite is about the reference table and the contract rule that reads
 * it, not about the loopback call itself).
 */
describe("GET /budget-codes", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("lists the twenty seeded CAPEX codes to any signed-in role", async () => {
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer()).get("/budget-codes").set(bearer(token));
    expect(response.status).toBe(200);
    const list = BudgetCodeList.parse(response.body);
    expect(list.items).toHaveLength(20);
    expect(list.items.every((item) => item.isCapex && item.active)).toBe(true);
    const byCode = new Map(list.items.map((item) => [item.code, item]));
    expect(byCode.get("7402")?.descriptionEl).toBe("Ιατρικός και λοιπός εξοπλισμός");
    expect(byCode.get("7585")?.descriptionEn).toBe("Ambulances");
  });

  it("accepts kind=capex and refuses any other kind", async () => {
    const token = await tokenFor(app, USERS.admin);
    const ok = await request(app.getHttpServer())
      .get("/budget-codes?kind=capex")
      .set(bearer(token));
    expect(ok.status).toBe(200);

    const bad = await request(app.getHttpServer())
      .get("/budget-codes?kind=opex")
      .set(bearer(token));
    expect(bad.status).toBe(400);
    expect(bad.body.key).toBe("errors.budgetCodeQueryNotValid");
  });

  it("refuses an unsigned request", async () => {
    const response = await request(app.getHttpServer()).get("/budget-codes");
    expect(response.status).toBe(401);
  });
});

describe("POST /budget-codes/sync", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("refuses a role that is not admin or finance", async () => {
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .post("/budget-codes/sync")
      .set(bearer(token));
    expect(response.status).toBe(403);
  });

  it("falls back to the seed list when eFinance is not configured, and finance may run it", async () => {
    const token = await tokenFor(app, USERS.finance);
    const response = await request(app.getHttpServer())
      .post("/budget-codes/sync")
      .set(bearer(token));
    expect(response.status).toBe(200);
    const result = BudgetCodeSyncResult.parse(response.body);
    expect(result.source).toBe("SEED");
    expect(result.upserted).toBe(20);
    // Nothing is missing from the reader's own list, so nothing deactivates.
    expect(result.deactivated).toBe(0);
  });
});

describe("a contract's budget code (ADR-0025)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("records the code and answers both its descriptions on the detail", async () => {
    const stamp = String(Date.now());
    const { contract } = await makeContract(app, stamp, { budgetCode: "7551" });
    const detail = ContractDetail.parse(contract);
    expect(detail.budgetCode).toBe("7551");
    expect(detail.budgetCodeDescriptionEl).toBe("Επιβατικά οχήματα");
    expect(detail.budgetCodeDescriptionEn).toBe("Passenger vehicles");
  });

  it("allows a null budget code on create", async () => {
    const stamp = String(Date.now());
    const { contract } = await makeContract(app, stamp, { budgetCode: null });
    expect(contract.budgetCode).toBeNull();
    expect(contract.budgetCodeDescriptionEl).toBeNull();
    expect(contract.budgetCodeDescriptionEn).toBeNull();
  });

  it("refuses a code that does not name an active row, with a 400 and both languages available", async () => {
    const stamp = String(Date.now());
    const admin = await tokenFor(app, USERS.admin);
    const project = await projectAt(app, "AWARDED", `Σύμβαση χωρίς κωδικό ${stamp}`);
    const contractor = await makeContractor(app, `Ανάδοχος κωδικού ${stamp}`);

    const response = await request(app.getHttpServer())
      .post(`/projects/${project.id}/contracts`)
      .set(bearer(admin))
      .send(contractBody(project.id, contractor.id, `ΤΥ/ΚΩΔ/${stamp}`, { budgetCode: "9999" }));
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.budgetCodeNotFound");

    const english = await request(app.getHttpServer())
      .post(`/projects/${project.id}/contracts`)
      .set(bearer(admin))
      .set("Accept-Language", "en")
      .send(contractBody(project.id, contractor.id, `ΤΥ/ΚΩΔ2/${stamp}`, { budgetCode: "9999" }));
    expect(english.status).toBe(400);
    expect(english.body.message).toContain("9999");
    expect(english.body.message).not.toBe(response.body.message);
  });

  it("is editable later, and clearing it back to null is allowed", async () => {
    const stamp = String(Date.now());
    const { contract } = await makeContract(app, stamp, { budgetCode: "7402" });
    const token = await tokenFor(app, USERS.admin);

    const changed = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(token))
      .send({ budgetCode: "7501" });
    expect(changed.status).toBe(200);
    expect(changed.body.budgetCode).toBe("7501");

    const cleared = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(token))
      .send({ budgetCode: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.budgetCode).toBeNull();

    const untouched = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(token))
      .send({ extensionDays: 1 });
    expect(untouched.status).toBe(200);
    expect(untouched.body.budgetCode).toBeNull();
  });

  it("refuses an update to a code that is not active", async () => {
    const stamp = String(Date.now());
    const { contract } = await makeContract(app, stamp, { budgetCode: "7402" });
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(token))
      .send({ budgetCode: "0000" });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.budgetCodeNotFound");
  });
});
