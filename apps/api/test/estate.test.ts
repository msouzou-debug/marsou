import type { INestApplication } from "@nestjs/common";
import type { OrgUnit } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createAppWith, createTestApp, tokenFor } from "./app";
import { contractBody, makeContract, makeContractor, projectAt } from "./contract-support";

/**
 * ADR-0019 — the two things that let eCapital sit next to eMAP and eFinance:
 * the entity code that says which hospital a row belongs to in all three
 * systems, and the contract reference eFinance can point an invoice at.
 */
describe("entity codes", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("gives every seeded unit its eFinance code, and no two the same", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    expect(response.status).toBe(200);

    const units = response.body as OrgUnit[];
    expect(units).toHaveLength(11);
    const codes = units.map((u) => u.entityCode);
    expect(codes.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("uses the exact strings eFinance uses, never a name", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    const byId = new Map((response.body as OrgUnit[]).map((u) => [u.id, u.entityCode]));
    // INTEGRATION-eMAP §2. Note that these are not eCapital's own unit codes:
    // Πάφος is PAF here and PAP there, Λεμεσός LMS and LGH, Μακάριος NAM3 and
    // ARC. That is exactly why the column exists.
    expect(byId.get("nicosia-general")).toBe("NGH");
    expect(byId.get("larnaca-general")).toBe("LAR");
    expect(byId.get("paphos-general")).toBe("PAP");
    expect(byId.get("limassol-general")).toBe("LGH");
    expect(byId.get("troodos")).toBe("TRD");
    expect(byId.get("namiii")).toBe("ARC");
    expect(byId.get("polis-chrysochous")).toBe("CHR");
    expect(byId.get("famagusta-general")).toBe("FAM");
    expect(byId.get("dypsy")).toBe("MH");
    expect(byId.get("ambulance")).toBe("AMB");
    // ASSUMPTION, flagged in ADR-0019: ΠΦΥ = Κέντρα Υγείας = HC.
    expect(byId.get("pfy")).toBe("HC");
  });

  it("invents no unit for eFinance's HQ or CNS", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    const codes = (response.body as OrgUnit[]).map((u) => u.entityCode);
    expect(codes).not.toContain("HQ");
    expect(codes).not.toContain("CNS");
  });
});

describe("contract references", () => {
  let app: INestApplication;
  const stamp = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("allocates CAP-YYYY-NNNN from the award year, and keeps contractNo as typed", async () => {
    const { contract } = await makeContract(app, stamp());
    expect(contract.ref).toMatch(/^CAP-2026-\d{4}$/);
    expect(contract.contractNo).toMatch(/^ΤΥ\/ΔΟΚ\//);
  });

  it("gives every contract a different reference when several are recorded at once", async () => {
    // ADR-0019: the advisory lock is what makes this queue rather than race.
    const token = await tokenFor(app, USERS.admin);
    const project = await projectAt(app, "IN_PROGRESS", `Ταυτόχρονες συμβάσεις ${stamp()}`);
    const contractor = await makeContractor(app, `Ανάδοχος ταυτόχρονος ${stamp()}`);

    const answers = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(app.getHttpServer())
          .post(`/projects/${project.id}/contracts`)
          .set(bearer(token))
          .send(contractBody(project.id, contractor.id, `ΤΥ/ΠΑΡ/${stamp()}/${i}`)),
      ),
    );

    expect(answers.every((a) => a.status === 201)).toBe(true);
    const refs = answers.map((a) => a.body.ref as string);
    expect(new Set(refs).size).toBe(8);
    expect(refs.every((r) => /^CAP-2026-\d{4}$/.test(r))).toBe(true);
  });

  it("refuses to change the reference, whatever asks", async () => {
    const { contract } = await makeContract(app, stamp());
    const token = await tokenFor(app, USERS.admin);
    // `ref` is not in ContractUpdate at all, so the API drops it — the
    // contract keeps the reference it was given.
    const patched = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(token))
      .send({ ref: "CAP-2026-9999", extensionDays: 3 });
    expect(patched.status).toBe(200);
    expect(patched.body.ref).toBe(contract.ref);
    expect(patched.body.extensionDays).toBe(3);
  });

  it("takes an eMAP reference and refuses one that is not eMAP's format", async () => {
    const { contract } = await makeContract(app, stamp(), { emapRef: "CON-2026-0042" });
    expect(contract.emapRef).toBe("CON-2026-0042");

    const token = await tokenFor(app, USERS.admin);
    const bad = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}`)
      .set(bearer(token))
      .send({ emapRef: "CON-26-42" });
    expect(bad.status).toBe(400);
  });
});

describe("GET /contracts/lookup", () => {
  let app: INestApplication;
  const stamp = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("finds a contract by its own reference", async () => {
    const { contract } = await makeContract(app, stamp());
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get(`/contracts/lookup?q=${encodeURIComponent(contract.ref)}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: contract.id });
  });

  it("finds it by the number off the tender papers", async () => {
    const mark = stamp();
    const { contract } = await makeContract(app, mark);
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get(`/contracts/lookup?q=${encodeURIComponent(contract.contractNo)}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(contract.id);
  });

  it("finds it however the Greek was capitalised or accented", async () => {
    const { contract } = await makeContract(app, stamp(), {}, USERS.admin);
    const token = await tokenFor(app, USERS.admin);
    // The stored number carries «ΤΥ/ΔΟΚ/…»; searching in lower case with an
    // accent on it has to find the same row (ecapital.normalise).
    const lower = contract.contractNo.toLowerCase().replace("δοκ", "δόκ");
    const response = await request(app.getHttpServer())
      .get(`/contracts/lookup?q=${encodeURIComponent(lower)}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(contract.id);
  });

  it("answers 404 for a reference nobody carries", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get("/contracts/lookup?q=CAP-1999-0001")
      .set(bearer(token));
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.contractNotFound");
  });

  it("answers the same 404 for a contract in a unit the caller may not see", async () => {
    // ADR-0010: not "forbidden" — it does not exist for them.
    const { contract } = await makeContract(app, stamp(), {}, USERS.admin, "larnaca-general");
    const outsider = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get(`/contracts/lookup?q=${encodeURIComponent(contract.ref)}`)
      .set(bearer(outsider));
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.contractNotFound");

    const insider = await tokenFor(app, USERS.engineerLarnaca);
    const allowed = await request(app.getHttpServer())
      .get(`/contracts/lookup?q=${encodeURIComponent(contract.ref)}`)
      .set(bearer(insider));
    expect(allowed.status).toBe(200);
  });

  it("wants a reference", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/contracts/lookup").set(bearer(token));
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.contractRefNeeded");
  });

  it("refuses a caller with no token", async () => {
    const response = await request(app.getHttpServer()).get("/contracts/lookup?q=CAP-2026-0001");
    expect(response.status).toBe(401);
  });
});

describe("GET /contracts", () => {
  let app: INestApplication;
  const stamp = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("lists only the caller's own units", async () => {
    const larnaca = await makeContract(app, stamp(), {}, USERS.admin, "larnaca-general");
    const nicosia = await makeContract(app, stamp(), {}, USERS.admin, "nicosia-general");

    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer()).get("/contracts").set(bearer(token));
    expect(response.status).toBe(200);

    const refs = (response.body.items as { ref: string; orgUnitId: string }[]).map((c) => c.ref);
    expect(refs).toContain(nicosia.contract.ref);
    expect(refs).not.toContain(larnaca.contract.ref);
    expect(
      (response.body.items as { orgUnitId: string }[]).every(
        (c) => c.orgUnitId === "nicosia-general",
      ),
    ).toBe(true);
  });

  it("narrows to one unit, and finds nothing in a unit the caller may not see", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const mine = await request(app.getHttpServer())
      .get("/contracts?unit=nicosia-general")
      .set(bearer(token));
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBeGreaterThan(0);

    const theirs = await request(app.getHttpServer())
      .get("/contracts?unit=larnaca-general")
      .set(bearer(token));
    expect(theirs.status).toBe(200);
    expect(theirs.body.items).toEqual([]);
  });

  it("searches the reference and the contractor without regard to case or accents", async () => {
    const { contract } = await makeContract(app, stamp());
    const token = await tokenFor(app, USERS.admin);
    const byRef = await request(app.getHttpServer())
      .get(`/contracts?q=${encodeURIComponent(contract.ref.toLowerCase())}`)
      .set(bearer(token));
    expect(byRef.status).toBe(200);
    expect((byRef.body.items as { ref: string }[]).map((c) => c.ref)).toContain(contract.ref);

    const byContractor = await request(app.getHttpServer())
      .get(`/contracts?q=${encodeURIComponent("ΑΝΑΔΟΧΟΣ ΔΟΚΙΜΗΣ")}`)
      .set(bearer(token));
    expect(byContractor.body.total).toBeGreaterThan(0);
  });

  it("refuses a caller with no token", async () => {
    const response = await request(app.getHttpServer()).get("/contracts");
    expect(response.status).toBe(401);
  });
});

describe("GET /config/links", () => {
  it("says nothing is there when the deployment has not been told", async () => {
    const app = await createTestApp();
    try {
      const token = await tokenFor(app, USERS.admin);
      const response = await request(app.getHttpServer()).get("/config/links").set(bearer(token));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ emapUrl: null, efinanceUrl: null });
    } finally {
      await app.close();
    }
  });

  it("hands back both base URLs, without their trailing slashes", async () => {
    const app = await createAppWith({
      EMAP_URL: "https://map.shso.online/",
      EFINANCE_URL: "https://finance.shso.online",
    });
    try {
      const token = await tokenFor(app, USERS.admin);
      const response = await request(app.getHttpServer()).get("/config/links").set(bearer(token));
      expect(response.body).toEqual({
        emapUrl: "https://map.shso.online",
        efinanceUrl: "https://finance.shso.online",
      });
    } finally {
      await app.close();
    }
  });

  it("is for signed-in callers only", async () => {
    const app = await createTestApp();
    try {
      const response = await request(app.getHttpServer()).get("/config/links");
      expect(response.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});
