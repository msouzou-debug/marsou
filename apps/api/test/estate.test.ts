import type { INestApplication } from "@nestjs/common";
import type { OrgUnit } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createAppWith, createTestApp, tokenFor } from "./app";
import { contractBody, makeContract, makeContractor, projectAt } from "./contract-support";

/**
 * ADR-0019 and ADR-0024 — the two things that let eCapital sit next to eMAP,
 * eFinance and eArchive: the entity code that says which hospital a row
 * belongs to in all of them, and the contract reference eFinance can point an
 * invoice at.
 */
describe("entity codes", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("gives every seeded unit its entity code, and no two the same", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    expect(response.status).toBe(200);

    const units = response.body as OrgUnit[];
    // Twelve: the Ambulance Service left ΟΚΥπΥ (ADR-0024) and Community
    // Nursing joined the register (ADR-0024's addendum, 20/09/2026).
    expect(units).toHaveLength(12);
    const codes = units.map((u) => u.entityCode);
    expect(codes.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("uses eArchive's site abbreviation for both codes, never a name", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    const units = response.body as OrgUnit[];
    const byId = new Map(units.map((u) => [u.id, u.entityCode]));
    // ADR-0024 (owner, 19/09/2026): all three systems key a place by
    // eArchive's abbreviation. eFinance's old strings (PAP, LGH, ARC, CHR, MH,
    // HC, TRD) are gone from this column — they live on in efinanceCode now
    // (ADR-0022's addendum, see the next test), permanently, not as a lookup.
    expect(byId.get("nicosia-general")).toBe("NGH");
    expect(byId.get("larnaca-general")).toBe("LAR");
    expect(byId.get("paphos-general")).toBe("PAF");
    expect(byId.get("limassol-general")).toBe("LGH");
    expect(byId.get("troodos")).toBe("KYP");
    expect(byId.get("namiii")).toBe("NAM");
    expect(byId.get("polis-chrysochous")).toBe("POL");
    expect(byId.get("famagusta-general")).toBe("FAM");
    expect(byId.get("dypsy")).toBe("MHS");
    expect(byId.get("pfy")).toBe("PHC");
    expect(byId.get("hq")).toBe("HQ");
    expect(byId.get("community-nursing")).toBe("CNS");

    // ADR-0024: `code` and `entityCode` are the same string now, on every
    // unit. Τροόδους keeps both its names and takes KYP.
    for (const u of units) expect(u.code).toBe(u.entityCode);
    expect(units.find((u) => u.id === "troodos")).toMatchObject({
      code: "KYP",
      nameEl: "Νοσοκομείο Τροόδους",
      nameEn: "Troodos Hospital",
    });
  });

  it("carries eFinance's own entity keys alongside entityCode, permanently (ADR-0022 addendum)", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    const units = response.body as OrgUnit[];
    const byId = new Map(units.map((u) => [u.id, u.efinanceCode]));

    // eFinance would not rename its own entity keys — foreign keys across
    // twelve of its own tables and SAP — so eCapital carries both from now
    // on, rather than the six-way lookup ADR-0024 §2 kept "until eFinance
    // aligns".
    expect(byId.get("nicosia-general")).toBe("NGH");
    expect(byId.get("larnaca-general")).toBe("LAR");
    expect(byId.get("paphos-general")).toBe("PAP");
    expect(byId.get("limassol-general")).toBe("LGH");
    expect(byId.get("troodos")).toBe("TRD");
    expect(byId.get("namiii")).toBe("ARC");
    expect(byId.get("polis-chrysochous")).toBe("CHR");
    expect(byId.get("famagusta-general")).toBe("FAM");
    expect(byId.get("dypsy")).toBe("MH");
    expect(byId.get("pfy")).toBe("HC");
    expect(byId.get("hq")).toBe("HQ");
    expect(byId.get("community-nursing")).toBe("CNS");

    // Every value is unique, and non-null for all twelve units.
    const codes = units.map((u) => u.efinanceCode);
    expect(codes.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has no Ambulance Service unit left", async () => {
    // Owner decision, 19/09/2026 (ADR-0024): the service is out of ΟΚΥπΥ, so
    // it is out of the register — not hidden, not empty, gone.
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    const units = response.body as OrgUnit[];
    expect(units.map((u) => u.id)).not.toContain("ambulance");
    expect(units.map((u) => u.code)).not.toContain("AMB");
    expect(units.map((u) => u.entityCode)).not.toContain("AMB");
  });

  it("gives HQ its own unit, entity code and CENTRAL type", async () => {
    // Owner decision, 19/09/2026 (ADR-0019, INTEGRATION-eFinance-eMAP-eCapital
    // §2): Central Administration can own projects too, so it is a unit like
    // any other now, not one of the two eFinance codes left unmapped.
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    const hq = (response.body as OrgUnit[]).find((u) => u.id === "hq");
    expect(hq).toMatchObject({
      code: "HQ",
      nameEl: "Κεντρικά Γραφεία",
      nameEn: "Central Offices",
      type: "CENTRAL",
      directorate: "KENTRIKI_DIOIKISI",
      costCentre: null,
      entityCode: "HQ",
    });
  });

  it("gives CNS its own unit now, correcting the 19/09/2026 errata (ADR-0024 addendum, 20/09/2026)", async () => {
    // CNS (Κοινοτική Νοσηλευτική, Community Nursing) used to
    // stay unmapped on the theory that it filed under HQ — ADR-0019, then
    // ADR-0024 §2. That theory was wrong on both counts: it is a unit of its
    // own, with its own eArchive folder, not HQ's.
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    const cns = (response.body as OrgUnit[]).find((u) => u.id === "community-nursing");
    expect(cns).toMatchObject({
      code: "CNS",
      nameEl: "Κοινοτική Νοσηλευτική",
      nameEn: "Community Nursing",
      type: "SERVICE",
      directorate: "PFY",
      costCentre: null,
      entityCode: "CNS",
      efinanceCode: "CNS",
    });
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
