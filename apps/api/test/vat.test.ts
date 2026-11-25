import type { INestApplication } from "@nestjs/common";
import { ContractDetail, PaymentCert, ProjectCost, Variation } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract } from "./contract-support";

/**
 * ADR-0038 — VAT on commitments (owner decision item 23). A contract, a
 * variation and a certificate store the NET and a rate; the database derives
 * VAT and gross; the commitment ledger and every budget comparison are GROSS.
 */
describe("VAT on contracts, variations and certificates (ADR-0038)", () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function contractDetail(id: string): Promise<ContractDetail> {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(server()).get(`/contracts/${id}`).set(bearer(token));
    expect(response.status).toBe(200);
    return ContractDetail.parse(response.body);
  }

  async function raise(contractId: string, body: Record<string, unknown>): Promise<Variation> {
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(server())
      .post(`/contracts/${contractId}/variations`)
      .set(bearer(estates))
      .send({ descriptionEl: "Πρόσθετες εργασίες", reason: "CLIENT_CHANGE", timeImpactDays: 0, ...body });
    expect(response.status).toBe(201);
    return Variation.parse(response.body);
  }

  async function approve(contractId: string, variationId: string): Promise<void> {
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const admin = await tokenFor(app, USERS.admin);
    expect(
      (await request(server()).post(`/contracts/${contractId}/variations/${variationId}/submit`).set(bearer(estates)))
        .status,
    ).toBe(200);
    const decided = await request(server())
      .post(`/contracts/${contractId}/variations/${variationId}/decide`)
      .set(bearer(admin))
      .send({ decision: "APPROVED", commentEl: null });
    expect(decided.status).toBe(200);
  }

  it("records a contract at its rate and answers VAT and gross from the database", async () => {
    const { contract } = await makeContract(app, `vat-5-${Date.now()}`, {
      originalValue: 200_000,
      vatRate: "REDUCED_5",
    });
    expect(contract.vatRate).toBe("REDUCED_5");
    expect(contract.originalValue).toBe(200_000);
    expect(contract.originalVat).toBe(10_000);
    expect(contract.originalGross).toBe(210_000);
    expect(contract.currentGross).toBe(210_000);
    expect(contract.currentVat).toBe(10_000);
  });

  it("gives a contract written without a rate 19 %", async () => {
    const { contract } = await makeContract(app, `vat-default-${Date.now()}`, { originalValue: 100_000 });
    expect(contract.vatRate).toBe("STANDARD_19");
    expect(contract.originalGross).toBe(119_000);
  });

  it("refuses a rate that is not one of the five", async () => {
    await expect(
      makeContract(app, `vat-bad-${Date.now()}`, { vatRate: "STANDARD_21" }),
    ).rejects.toThrow(/400/);
  });

  it("gives a variation the contract's rate unless the raiser chose another, and commits approved ones gross", async () => {
    const { contract, project } = await makeContract(app, `vat-var-${Date.now()}`, { originalValue: 100_000 });

    const inherited = await raise(contract.id, { value: 10_000 });
    expect(inherited.vatRate).toBe("STANDARD_19");
    expect(inherited.vat).toBe(1_900);
    expect(inherited.gross).toBe(11_900);

    const exempt = await raise(contract.id, { value: 4_000, vatRate: "EXEMPT" });
    expect(exempt.vatRate).toBe("EXEMPT");
    expect(exempt.gross).toBe(4_000);

    // An omission is negative, its VAT too.
    const omission = await raise(contract.id, { value: -1_000, vatRate: "REDUCED_9" });
    expect(omission.vat).toBe(-90);
    expect(omission.gross).toBe(-1_090);

    // Pending: proposals, counted in neither commitment.
    await request(server())
      .post(`/contracts/${contract.id}/variations/${exempt.id}/submit`)
      .set(bearer(await tokenFor(app, USERS.estatesNicosia)));
    let detail = await contractDetail(contract.id);
    expect(detail.currentGross).toBe(119_000);
    expect(detail.pendingVariationsTotal).toBe(4_000);
    expect(detail.pendingVariationsGross).toBe(4_000);

    await approve(contract.id, inherited.id);
    detail = await contractDetail(contract.id);
    expect(detail.currentValue).toBe(110_000);
    expect(detail.currentGross).toBe(130_900);
    expect(detail.currentVat).toBe(20_900);
    expect(detail.approvedVariationsTotal).toBe(10_000);
    expect(detail.approvedVariationsGross).toBe(11_900);
    // The 10 % limit is net ÷ net (contractual): exactly 10 %, no warning.
    expect(detail.variationPctOfOriginal).toBe(10);

    // RULE (ADR-0038 §5): the project's commitment is the gross, and the
    // forecast adds the pending variations gross at the weight.
    const finance = await tokenFor(app, USERS.finance);
    const cost = ProjectCost.parse(
      (await request(server()).get(`/projects/${project.id}/cost`).set(bearer(finance))).body,
    );
    expect(cost.ledgers.committed).toBe(130_900);
    expect(cost.ledgers.forecast).toBe(130_900 + 4_000 * 0.5);
  });

  it("lets a variation's rate be changed while it is a draft", async () => {
    const { contract } = await makeContract(app, `vat-edit-${Date.now()}`);
    const variation = await raise(contract.id, { value: 2_000 });
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const patched = await request(server())
      .patch(`/contracts/${contract.id}/variations/${variation.id}`)
      .set(bearer(estates))
      .send({ vatRate: "REDUCED_5" });
    expect(patched.status).toBe(200);
    expect(Variation.parse(patched.body)).toMatchObject({ vatRate: "REDUCED_5", vat: 100, gross: 2_100 });
  });

  it("corrects a contract's rate without moving the rate its variations carry", async () => {
    const { contract } = await makeContract(app, `vat-fix-${Date.now()}`, { originalValue: 100_000 });
    const variation = await raise(contract.id, { value: 10_000 });
    await approve(contract.id, variation.id);

    const admin = await tokenFor(app, USERS.admin);
    // A PATCH that does not name the rate leaves it alone.
    const untouched = await request(server())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(admin))
      .send({ sapPoNumber: "4500900999" });
    expect(untouched.status).toBe(200);
    expect(untouched.body.vatRate).toBe("STANDARD_19");

    const fixed = await request(server())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(admin))
      .send({ vatRate: "ZERO" });
    expect(fixed.status).toBe(200);
    const detail = ContractDetail.parse(fixed.body);
    expect(detail.vatRate).toBe("ZERO");
    expect(detail.originalGross).toBe(100_000);
    // 100.000 at 0 % + the approved variation at its own 19 %.
    expect(detail.currentGross).toBe(111_900);
    expect(detail.variations[0]?.vatRate).toBe("STANDARD_19");
  });

  it("puts VAT on a certificate's net payable at the contract's rate, or the one chosen", async () => {
    const { contract } = await makeContract(app, `vat-cert-${Date.now()}`, {
      originalValue: 400_000,
      vatRate: "REDUCED_9",
      retentionPct: 5,
    });
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const first = await request(server())
      .post(`/contracts/${contract.id}/payment-certs`)
      .set(bearer(estates))
      .send({ periodFrom: "2026-10-01", periodTo: "2026-10-31", workDoneValue: 100_000, materialsOnSite: 0 });
    expect(first.status).toBe(201);
    const cert = PaymentCert.parse(first.body);
    // 100.000 − 5 % retention = 95.000 net payable; 9 % of it.
    expect(cert.netPayable).toBe(95_000);
    expect(cert.vatRate).toBe("REDUCED_9");
    expect(cert.vat).toBe(8_550);
    expect(cert.grossPayable).toBe(103_550);

    const second = await request(server())
      .post(`/contracts/${contract.id}/payment-certs`)
      .set(bearer(estates))
      .send({
        periodFrom: "2026-11-01",
        periodTo: "2026-11-30",
        workDoneValue: 150_000,
        materialsOnSite: 0,
        vatRate: "STANDARD_19",
      });
    expect(second.status).toBe(201);
    // 150.000 − 7.500 retention − 100.000 previously certified = 42.500.
    expect(PaymentCert.parse(second.body)).toMatchObject({
      netPayable: 42_500,
      vatRate: "STANDARD_19",
      vat: 8_075,
      grossPayable: 50_575,
    });
  });

  it("warns on a year's budget the gross commitment passes even when the net does not", async () => {
    const { contract, project } = await makeContract(app, `vat-budget-${Date.now()}`, {
      originalValue: 100_000,
      awardDate: "2026-09-01",
      startDate: "2026-09-15",
    });
    expect(contract.currentGross).toBe(119_000);
    const finance = await tokenFor(app, USERS.finance);
    // Above the net, below the gross: the budget, written with VAT, is short.
    const written = await request(server())
      .put(`/projects/${project.id}/budget-lines`)
      .set(bearer(finance))
      .send({ lines: [{ budgetYear: 2026, amount: 110_000, category: "works", sapGl: null, lineType: "BUDGET" }] });
    expect(written.status).toBe(200);
    const cost = ProjectCost.parse(
      (await request(server()).get(`/projects/${project.id}/cost`).set(bearer(finance))).body,
    );
    const year = cost.warnings.find((w) => w.key === "commitmentOverYearBudget");
    expect(year?.amount).toBe(9_000);
    const total = cost.warnings.find((w) => w.key === "forecastOverApproved");
    expect(total?.amount).toBe(9_000);
  });
});
