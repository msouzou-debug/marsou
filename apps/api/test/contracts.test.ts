import type { INestApplication } from "@nestjs/common";
import { BoqItem, ContractDetail, ContractList } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { contractBody, makeContract, makeContractor, projectAt } from "./contract-support";

/**
 * R08 — the contract register, and the two rules that guard the door:
 * a blacklisted contractor takes no new contract, and a project that has not
 * been awarded has nothing to hang one on (CAPEX-01 §1: the tender stage
 * lives in e-Procurement).
 *
 * As everywhere else, nobody here asks a service for permission. The row
 * policies decide, and a contract in a unit the caller may not see is a 404.
 */
describe("POST /projects/:id/contracts", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("records the contract and starts its current value at the original", async () => {
    const stamp = String(Date.now());
    const { contract } = await makeContract(app, stamp);
    const detail = ContractDetail.parse(contract);

    expect(detail.originalValue).toBe(500_000);
    // RULE (CAPEX-01 §7): current value = original + approved variations, and
    // there are none yet.
    expect(detail.currentValue).toBe(500_000);
    expect(detail.currency).toBe("EUR");
    expect(detail.boq).toEqual([]);
    expect(detail.variations).toEqual([]);
    expect(detail.approvedVariationsTotal).toBe(0);
    expect(detail.pendingVariationsTotal).toBe(0);
    expect(detail.variationPctOfOriginal).toBe(0);
    expect(detail.project.code).toMatch(/^NGH-\d{4}-\d{3}$/);
    expect(detail.contractor.blacklisted).toBe(false);
  });

  it("refuses a blacklisted contractor", async () => {
    // RULE (R08): the contracts it already holds run on; this one does not
    // start.
    const stamp = String(Date.now());
    const admin = await tokenFor(app, USERS.admin);
    const project = await projectAt(app, "AWARDED", `Έργο με αποκλεισμένο ${stamp}`);
    const contractor = await makeContractor(app, `Αποκλεισμένος ${stamp}`);
    await request(app.getHttpServer())
      .patch(`/contractors/${contractor.id}`)
      .set(bearer(admin))
      .send({ blacklisted: true });

    const response = await request(app.getHttpServer())
      .post(`/projects/${project.id}/contracts`)
      .set(bearer(admin))
      .send(contractBody(project.id, contractor.id, `ΤΥ/ΜΑΥ/${stamp}`));
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.contractorBlacklisted");
    expect(response.body.message).toContain(contractor.name);
  });

  it("refuses a project that has not been awarded", async () => {
    // RULE (CAPEX-01 §1): the system starts at the awarded contract.
    const stamp = String(Date.now());
    const admin = await tokenFor(app, USERS.admin);
    const project = await projectAt(app, "TENDERED", `Έργο σε διαγωνισμό ${stamp}`);
    const contractor = await makeContractor(app, `Πρόωρος ανάδοχος ${stamp}`);

    const response = await request(app.getHttpServer())
      .post(`/projects/${project.id}/contracts`)
      .set(bearer(admin))
      .send(contractBody(project.id, contractor.id, `ΤΥ/ΠΡΩ/${stamp}`));
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.projectNotAwarded");
  });

  it("refuses a second contract with the same number in the same unit", async () => {
    const stamp = String(Date.now());
    const { contract, project } = await makeContract(app, stamp);
    const admin = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .post(`/projects/${project.id}/contracts`)
      .set(bearer(admin))
      .send(contractBody(project.id, contract.contractorId, contract.contractNo));
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.contractNoTaken");
  });

  it("refuses a body that is not a contract, and one pointing at another project", async () => {
    const stamp = String(Date.now());
    const admin = await tokenFor(app, USERS.admin);
    const project = await projectAt(app, "AWARDED", `Έργο με κακό σώμα ${stamp}`);
    const contractor = await makeContractor(app, `Ανάδοχος σώματος ${stamp}`);

    const bad = await request(app.getHttpServer())
      .post(`/projects/${project.id}/contracts`)
      .set(bearer(admin))
      .send({ ...contractBody(project.id, contractor.id, `ΤΥ/ΚΑΚ/${stamp}`), type: "WHATEVER" });
    expect(bad.status).toBe(400);
    expect(bad.body.key).toBe("errors.contractNotValid");

    const mismatched = await request(app.getHttpServer())
      .post(`/projects/${project.id}/contracts`)
      .set(bearer(admin))
      .send(contractBody(crypto.randomUUID(), contractor.id, `ΤΥ/ΑΛΛ/${stamp}`));
    expect(mismatched.status).toBe(400);
  });

  it("refuses the clinical approver and the auditor", async () => {
    const stamp = String(Date.now());
    const project = await projectAt(app, "AWARDED", `Έργο χωρίς δικαίωμα ${stamp}`);
    const contractor = await makeContractor(app, `Ανάδοχος χωρίς δικαίωμα ${stamp}`);

    for (const email of [USERS.clinicalNicosia, USERS.auditor, USERS.executive]) {
      const token = await tokenFor(app, email);
      const response = await request(app.getHttpServer())
        .post(`/projects/${project.id}/contracts`)
        .set(bearer(token))
        .send(contractBody(project.id, contractor.id, `ΤΥ/ΑΡΝ/${stamp}/${email.slice(0, 3)}`));
      expect(response.status).toBe(403);
    }
  });
});

describe("GET /projects/:id/contracts and GET /contracts/:id", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("lists a project's contracts with the contractor's name on each", async () => {
    const stamp = String(Date.now());
    const { contract, project } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get(`/projects/${project.id}/contracts`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    const list = ContractList.parse(response.body);
    expect(list.total).toBe(1);
    expect(list.items[0].id).toBe(contract.id);
    expect(list.items[0].contractorName).toContain("Ανάδοχος δοκιμής");
  });

  it("answers 404 when the Larnaca engineer opens a Nicosia contract", async () => {
    // Not 403. Under the policy the row does not exist for this caller, and a
    // 403 would confirm that it does (CAPEX-01 §10).
    const stamp = String(Date.now());
    const { contract, project } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.engineerLarnaca);

    const one = await request(app.getHttpServer())
      .get(`/contracts/${contract.id}`)
      .set(bearer(token));
    expect(one.status).toBe(404);
    expect(one.body.key).toBe("errors.contractNotFound");

    const viaProject = await request(app.getHttpServer())
      .get(`/projects/${project.id}/contracts`)
      .set(bearer(token));
    expect(viaProject.status).toBe(404);
    expect(viaProject.body.key).toBe("errors.projectNotFound");
  });

  it("answers 404 for an id that is not a contract at all", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get("/contracts/not-a-uuid")
      .set(bearer(token));
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.contractNotFound");
  });
});

describe("PATCH /contracts/:id", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("changes the terms the body names and leaves the value alone", async () => {
    const stamp = String(Date.now());
    const { contract } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.admin);

    const response = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(token))
      // originalValue and currentValue are not fields of ContractUpdate; a
      // body that carries them changes nothing.
      .send({ extensionDays: 30, retentionPct: 3, currentValue: 9_999_999 });
    expect(response.status).toBe(200);
    const detail = ContractDetail.parse(response.body);
    expect(detail.extensionDays).toBe(30);
    expect(detail.retentionPct).toBe(3);
    expect(detail.currentValue).toBe(500_000);
    expect(detail.contractNo).toBe(contract.contractNo);
  });

  it("refuses a read-only account", async () => {
    const stamp = String(Date.now());
    const { contract } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.auditor);
    const response = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(token))
      .send({ extensionDays: 5 });
    expect(response.status).toBe(403);
  });
});

describe("PUT /contracts/:id/boq", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("works out each amount and replaces the whole bill", async () => {
    const stamp = String(Date.now());
    const { contract } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.admin);

    const first = await request(app.getHttpServer())
      .put(`/contracts/${contract.id}/boq`)
      .set(bearer(token))
      .send([
        { itemNo: "A.01", descriptionEl: "Καθαιρέσεις", unit: "m3", qty: 12.5, rate: 40, amount: 1 },
        { itemNo: "A.02", descriptionEl: "Σκυρόδεμα", unit: "m3", qty: 10, rate: 145.5 },
      ]);
    expect(first.status).toBe(200);
    const bill = BoqItem.array().parse(first.body);
    expect(bill).toHaveLength(2);
    // RULE (contract BoqItem): the amount is qty × rate, worked out here, and
    // an amount in the body is ignored.
    expect(bill[0].amount).toBe(500);
    expect(bill[1].amount).toBe(1455);

    const second = await request(app.getHttpServer())
      .put(`/contracts/${contract.id}/boq`)
      .set(bearer(token))
      .send([{ itemNo: "B.01", descriptionEl: "Χρωματισμοί", unit: "m2", qty: 100, rate: 11.5 }]);
    expect(second.status).toBe(200);
    const replaced = BoqItem.array().parse(second.body);
    expect(replaced.map((i) => i.itemNo)).toEqual(["B.01"]);

    const detail = await request(app.getHttpServer())
      .get(`/contracts/${contract.id}`)
      .set(bearer(token));
    expect(ContractDetail.parse(detail.body).boq).toHaveLength(1);
  });

  it("refuses two lines with the same item number", async () => {
    const stamp = String(Date.now());
    const { contract } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .put(`/contracts/${contract.id}/boq`)
      .set(bearer(token))
      .send([
        { itemNo: "A.01", descriptionEl: "Μία", unit: "m2", qty: 1, rate: 1 },
        { itemNo: "A.01", descriptionEl: "Δύο", unit: "m2", qty: 2, rate: 2 },
      ]);
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.boqItemNoRepeated");
  });

  it("refuses a body that is not a bill, and a read-only account", async () => {
    const stamp = String(Date.now());
    const { contract } = await makeContract(app, stamp);
    const admin = await tokenFor(app, USERS.admin);
    const bad = await request(app.getHttpServer())
      .put(`/contracts/${contract.id}/boq`)
      .set(bearer(admin))
      .send([{ itemNo: "A.01", descriptionEl: "Χωρίς ποσότητα", unit: "m2" }]);
    expect(bad.status).toBe(400);
    expect(bad.body.key).toBe("errors.boqNotValid");

    const auditor = await tokenFor(app, USERS.auditor);
    const refused = await request(app.getHttpServer())
      .put(`/contracts/${contract.id}/boq`)
      .set(bearer(auditor))
      .send([{ itemNo: "A.01", descriptionEl: "Μία", unit: "m2", qty: 1, rate: 1 }]);
    expect(refused.status).toBe(403);
  });
});
