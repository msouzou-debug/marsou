import type { INestApplication } from "@nestjs/common";
import { Inbox } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { M3_USERS, draftPermit, nicosiaAreas, runIcra, submit, type AreaIds } from "./permit-support";

/**
 * S14 — Εγκρίσεις, the approvals inbox.
 *
 * UI §5 S14: «Row: type icon · what · where (unit › area) · who asked ·
 * waiting time · SlaChip», and the DecisionPanel shows exactly three facts.
 * The contract types that as `facts.length === 3`, so the shape is not an
 * opinion — a fourth fact fails `Inbox.parse` before it reaches a screen.
 */
describe("the approvals inbox", () => {
  let app: INestApplication;
  let areas: AreaIds;
  let stamp = 0;

  beforeAll(async () => {
    app = await createTestApp();
    areas = await nicosiaAreas(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const title = (what: string) => `${what} ${Date.now()}-${(stamp += 1)}`;

  async function inboxFor(email: string): Promise<Inbox> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer()).get("/inbox").set(bearer(token));
    expect(response.status).toBe(200);
    return Inbox.parse(response.body);
  }

  it("lists the permit lines waiting on the caller, decidable, with three facts", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Στο εισερχόμενο"),
      areaIds: [areas.theatre],
    });
    await runIcra(app, permit.id, "C");
    const submitted = await submit(app, permit.id);

    const inbox = await inboxFor(USERS.clinicalNicosia);
    const mine = inbox.items.filter((item) =>
      submitted.approvals.some((line) => line.id === item.id),
    );
    expect(mine.length).toBeGreaterThan(0);
    for (const item of mine) {
      expect(item.type).toBe("SHUTDOWN");
      expect(item.decidable).toBe(true);
      expect(item.facts).toHaveLength(3);
      expect(item.facts[0].label).toBe("Κατηγορία προφυλάξεων");
      expect(item.facts[0].value).toContain("IV");
      expect(item.facts[2].label).toBe("Χώροι");
      expect(item.whereEl).toContain("Γενικό Νοσοκομείο Λευκωσίας");
      expect(item.href).toBe(`/permits/${permit.id}`);
      expect(item.dueAt).not.toBeNull();
      expect(item.slaState).toBe("GREEN");
      expect(item.requestedByName).toBe("Ανδρέας Παπαδόπουλος");
    }
  });

  it("does not put a line in somebody else's inbox", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Όχι για τον μηχανικό"),
      areaIds: [areas.theatre],
    });
    await runIcra(app, permit.id, "C");
    const submitted = await submit(app, permit.id);
    const ward = submitted.approvals.find((line) => line.role === "WARD_MANAGER");

    const engineerInbox = await inboxFor(USERS.engineerLarnaca);
    expect(engineerInbox.items.map((item) => item.id)).not.toContain(ward?.id);
  });

  it("drops a line the moment it is decided", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Αποφασισμένη γραμμή"),
      areaIds: [areas.theatre],
    });
    await runIcra(app, permit.id, "C");
    const submitted = await submit(app, permit.id);
    const ic = submitted.approvals.find((line) => line.role === "INFECTION_CONTROL");

    const before = await inboxFor(USERS.clinicalNicosia);
    expect(before.items.map((item) => item.id)).toContain(ic?.id);

    const token = await tokenFor(app, USERS.clinicalNicosia);
    await request(app.getHttpServer())
      .post(`/permits/${permit.id}/approvals/${ic?.id}/decide`)
      .set(bearer(token))
      .send({ decision: "APPROVED", commentEl: null });

    const after = await inboxFor(USERS.clinicalNicosia);
    expect(after.items.map((item) => item.id)).not.toContain(ic?.id);
  });

  it("counts per type", async () => {
    const inbox = await inboxFor(USERS.clinicalNicosia);
    expect(Object.keys(inbox.counts).sort()).toEqual([
      "OTHER",
      "PAYMENT_CERT",
      "SHUTDOWN",
      "VARIATION",
    ]);
    const shutdowns = inbox.items.filter((item) => item.type === "SHUTDOWN").length;
    expect(inbox.counts.SHUTDOWN).toBe(shutdowns);
  });

  it("shows the variations and the certificates waiting, not decidable here", async () => {
    // The seeded SUBMITTED variations are at Λάρνακα, and an inbox is what the
    // row policies already let the caller see, narrowed to what waits on them
    // — so this is the account that reads every unit.
    const inbox = await inboxFor(USERS.admin);
    const variations = inbox.items.filter((item) => item.type === "VARIATION");
    expect(variations.length).toBeGreaterThan(0);
    for (const item of variations) {
      expect(item.decidable).toBe(false);
      expect(item.href).toMatch(/^\/contracts\/[0-9a-f-]+\/variations$/);
      expect(item.facts).toHaveLength(3);
      expect(item.slaState).toBeNull();
    }

    const certs = inbox.items.filter((item) => item.type === "PAYMENT_CERT");
    for (const item of certs) {
      expect(item.decidable).toBe(false);
      expect(item.href).toMatch(/^\/certificates\/[0-9a-f-]+$/);
    }
  });

  it("gives a technician an empty inbox rather than a refusal", async () => {
    const inbox = await inboxFor(USERS.technicianNicosia);
    expect(inbox.items).toEqual([]);
    expect(inbox.counts.SHUTDOWN).toBe(0);
  });

  it("tracks unread per person", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Αδιάβαστο"),
      areaIds: [areas.ward],
    });
    await runIcra(app, permit.id, "B");
    const submitted = await submit(app, permit.id);
    const nursing = submitted.approvals.find((line) => line.role === "NURSING");

    const before = await inboxFor(M3_USERS.nursingNicosia);
    expect(before.items.find((item) => item.id === nursing?.id)?.unread).toBe(true);

    const token = await tokenFor(app, M3_USERS.nursingNicosia);
    const marked = await request(app.getHttpServer())
      .post(`/inbox/${nursing?.id}/read`)
      .set(bearer(token));
    expect(marked.status).toBe(204);

    const after = await inboxFor(M3_USERS.nursingNicosia);
    expect(after.items.find((item) => item.id === nursing?.id)?.unread).toBe(false);

    // Reading it is the reader's own business and nobody else's.
    const other = await inboxFor(USERS.clinicalNicosia);
    const sameItem = other.items.find((item) => item.id === nursing?.id);
    expect(sameItem).toBeUndefined();
  });

  it("marks the same item read twice without complaining", async () => {
    const token = await tokenFor(app, USERS.clinicalNicosia);
    for (let i = 0; i < 2; i += 1) {
      const response = await request(app.getHttpServer())
        .post("/inbox/some-item-id/read")
        .set(bearer(token));
      expect(response.status).toBe(204);
    }
  });
});
