import type { INestApplication } from "@nestjs/common";
import { Inbox, ShutdownPermit } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { draftPermit, nicosiaAreas, runIcra, submit, type AreaIds } from "./permit-support";

/**
 * OWNER UAT 25/11/2026, the three permit findings.
 *
 *   3. «Approve and Return with comments do not work»: the estates head is
 *      the unit's TECHNICAL (and SAFETY) approver, the routing gives them the
 *      line, and the decide route refused them because it asked only the
 *      clinical row of the role matrix.
 *   2. «The edit function is missing»: a returned permit is edited through
 *      PATCH, audited, and a change of rooms clears the stale ICRA.
 *   1. «ICRA stops»: a line with nobody appointed waits on the administrator,
 *      and the administrator's inbox now says so.
 *
 * The requester is the Nicosia engineer, never the estates head, so the
 * TECHNICAL line resolves to the estates head (ADR-0026's segregation).
 */
const ENGINEER_NICOSIA = "engineer.nicosia@ecapital.test";

describe("permits, owner UAT 25/11/2026", () => {
  let app: INestApplication;
  let client: Client;
  let areas: AreaIds;
  let stamp = 0;

  beforeAll(async () => {
    app = await createTestApp();
    client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
    areas = await nicosiaAreas(app);
  });
  afterAll(async () => {
    await client.end();
    await app.close();
  });

  const title = (what: string) => `${what} ${Date.now()}-${(stamp += 1)}`;

  async function inboxFor(email: string): Promise<Inbox> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer()).get("/inbox").set(bearer(token));
    expect(response.status).toBe(200);
    return Inbox.parse(response.body);
  }

  async function submittedByEngineer(what: string): Promise<ShutdownPermit> {
    const permit = await draftPermit(app, {
      titleEl: title(what),
      areaIds: [areas.office],
      email: ENGINEER_NICOSIA,
    });
    await runIcra(app, permit.id, "A", ENGINEER_NICOSIA);
    return submit(app, permit.id, ENGINEER_NICOSIA);
  }

  async function decide(
    email: string,
    permitId: string,
    lineId: string,
    decision: "APPROVED" | "RETURNED" | "REJECTED",
    commentEl: string | null = null,
  ) {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer())
      .post(`/permits/${permitId}/approvals/${lineId}/decide`)
      .set(bearer(token))
      .send({ decision, commentEl });
  }

  it("lets the estates head approve the TECHNICAL line the routing gave them", async () => {
    const submitted = await submittedByEngineer("Τεχνική έγκριση");
    const technical = submitted.approvals.find((line) => line.role === "TECHNICAL");
    expect(technical?.approverName).toBe("Ανδρέας Παπαδόπουλος");

    const inbox = await inboxFor(USERS.estatesNicosia);
    const item = inbox.items.find((row) => row.id === technical?.id);
    expect(item?.decidable).toBe(true);
    expect(item?.note).toBeNull();

    const response = await decide(USERS.estatesNicosia, submitted.id, technical!.id, "APPROVED");
    expect(response.status).toBe(200);
    const after = response.body as ShutdownPermit;
    expect(after.approvals.find((line) => line.id === technical?.id)?.decision).toBe("APPROVED");

    // Approve moves the item on: it is not in the inbox any more.
    const again = await inboxFor(USERS.estatesNicosia);
    expect(again.items.map((row) => row.id)).not.toContain(technical?.id);
  });

  it("still refuses the estates head a line that is waiting on somebody else", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Κλινική γραμμή"),
      areaIds: [areas.theatre],
      email: ENGINEER_NICOSIA,
    });
    await runIcra(app, permit.id, "C", ENGINEER_NICOSIA);
    const submitted = await submit(app, permit.id, ENGINEER_NICOSIA);
    const ic = submitted.approvals.find((line) => line.role === "INFECTION_CONTROL");
    const response = await decide(USERS.estatesNicosia, submitted.id, ic!.id, "APPROVED");
    expect(response.status).toBe(403);
    expect(response.body.key).toBe("errors.permitDecisionNotYours");
  });

  it("returns a permit to its requester, who sees it, edits it and submits it again", async () => {
    const submitted = await submittedByEngineer("Επιστροφή στον αιτούντα");
    const technical = submitted.approvals.find((line) => line.role === "TECHNICAL")!;

    // A return needs a comment, and says so.
    const bare = await decide(USERS.estatesNicosia, submitted.id, technical.id, "RETURNED", "  ");
    expect(bare.status).toBe(422);
    expect(bare.body.key).toBe("errors.permitCommentRequired");

    const returned = await decide(
      USERS.estatesNicosia,
      submitted.id,
      technical.id,
      "RETURNED",
      "Μετακινήστε το παράθυρο εκτός ωρών λειτουργίας.",
    );
    expect(returned.status).toBe(200);
    expect((returned.body as ShutdownPermit).status).toBe("DRAFT");

    // The requester's inbox carries it, with the comment and the sentence.
    const requesterInbox = await inboxFor(ENGINEER_NICOSIA);
    const item = requesterInbox.items.find((row) => row.id === technical.id);
    expect(item?.decidable).toBe(false);
    expect(item?.href).toBe(`/permits/${submitted.id}`);
    expect(item?.facts[0].value).toBe("Μετακινήστε το παράθυρο εκτός ωρών λειτουργίας.");
    expect(item?.note).toContain("Ανδρέας Παπαδόπουλος");

    // The edit: same permission as raising one, audited, and a change of
    // rooms clears the ICRA that was worked out over the old ones.
    const token = await tokenFor(app, ENGINEER_NICOSIA);
    const patched = await request(app.getHttpServer())
      .patch(`/permits/${submitted.id}`)
      .set(bearer(token))
      .send({ affectedAreaIds: [areas.office, areas.opd], titleEl: "Διορθωμένη αίτηση" });
    expect(patched.status).toBe(200);
    const edited = patched.body as ShutdownPermit;
    expect(edited.titleEl).toBe("Διορθωμένη αίτηση");
    expect(edited.icra).toBeNull();

    const { rows } = await client.query(
      `select action from ecapital.audit_log
        where entity_type = 'shutdown_permit' and entity_id = $1 and action = 'UPDATE'`,
      [submitted.id],
    );
    expect(rows.length).toBeGreaterThan(0);

    // Without a fresh ICRA the submission is refused with a sentence.
    const early = await request(app.getHttpServer())
      .post(`/permits/${submitted.id}/transition`)
      .set(bearer(token))
      .send({ to: "SUBMITTED" });
    expect(early.status).toBe(422);
    expect(early.body.key).toBe("errors.permitIcraRequired");

    await runIcra(app, submitted.id, "A", ENGINEER_NICOSIA);
    const again = await submit(app, submitted.id, ENGINEER_NICOSIA);
    expect(again.status).toBe("CLINICAL_REVIEW");
    expect(again.ref).toBe(submitted.ref);

    // Resubmitted: the returned item is gone from the requester's inbox.
    const after = await inboxFor(ENGINEER_NICOSIA);
    expect(after.items.map((row) => row.id)).not.toContain(technical.id);
  });

  it("keeps the ICRA when an edit leaves the rooms and the work as they were", async () => {
    const submitted = await submittedByEngineer("Μόνο ο τίτλος");
    const technical = submitted.approvals.find((line) => line.role === "TECHNICAL")!;
    await decide(USERS.estatesNicosia, submitted.id, technical.id, "RETURNED", "Πιο σαφής τίτλος.");
    const token = await tokenFor(app, ENGINEER_NICOSIA);
    const patched = await request(app.getHttpServer())
      .patch(`/permits/${submitted.id}`)
      .set(bearer(token))
      .send({ titleEl: "Σαφέστερος τίτλος", affectedAreaIds: [areas.office], workKind: "MAINTENANCE" });
    expect(patched.status).toBe(200);
    expect((patched.body as ShutdownPermit).icra).not.toBeNull();
  });

  it("refuses an edit once the permit is in review, with the sentence that says what to do", async () => {
    const submitted = await submittedByEngineer("Σε έγκριση");
    const token = await tokenFor(app, ENGINEER_NICOSIA);
    const response = await request(app.getHttpServer())
      .patch(`/permits/${submitted.id}`)
      .set(bearer(token))
      .send({ titleEl: "Αλλαγή μετά την υποβολή" });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitNotDraft");
  });

  it("refuses the edit to a role that does not raise permits", async () => {
    const permit = await draftPermit(app, { titleEl: title("Όχι για τον τεχνίτη"), areaIds: [areas.office] });
    const token = await tokenFor(app, USERS.technicianNicosia);
    const response = await request(app.getHttpServer())
      .patch(`/permits/${permit.id}`)
      .set(bearer(token))
      .send({ titleEl: "Από τεχνίτη" });
    expect(response.status).toBe(403);
  });

  it("puts a line with no approver in the administrator's inbox, with the reason", async () => {
    // Larnaca has a TECHNICAL approver and nobody else: a Class III+ permit
    // there routes INFECTION_CONTROL to nobody.
    const larnaca = await request(app.getHttpServer())
      .get("/org-units/larnaca-general/areas")
      .set(bearer(await tokenFor(app, USERS.admin)));
    const areaId = larnaca.body.buildings[0].floors[0].areas[0].id as string;
    const permit = await draftPermit(app, {
      titleEl: title("Χωρίς εγκρίνοντα"),
      areaIds: [areaId],
      email: USERS.engineerLarnaca,
    });
    await runIcra(app, permit.id, "D", USERS.engineerLarnaca);
    const submitted = await submit(app, permit.id, USERS.engineerLarnaca);
    const unassigned = submitted.approvals.filter((line) => line.approverId === null);
    expect(unassigned.length).toBeGreaterThan(0);

    const inbox = await inboxFor(USERS.admin);
    for (const line of unassigned) {
      const item = inbox.items.find((row) => row.id === line.id);
      expect(item?.decidable).toBe(true);
      expect(item?.note).toContain("Δεν έχει οριστεί εγκρίνων");
      // A ward manager's line names its own room, so several read apart.
      if (line.areaNameEl) expect(item?.whereEl.endsWith(line.areaNameEl)).toBe(true);
    }

    // And the administrator can move it.
    const response = await decide(USERS.admin, submitted.id, unassigned[0].id, "APPROVED");
    expect(response.status).toBe(200);
  });

  it("keeps an administrator's own unassigned lines out of their inbox (ADR-0015)", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Του διαχειριστή"),
      areaIds: [areas.theatre],
      email: USERS.admin,
    });
    await runIcra(app, permit.id, "C", USERS.admin);
    const submitted = await submit(app, permit.id, USERS.admin);
    const inbox = await inboxFor(USERS.admin);
    const ids = new Set(inbox.items.map((row) => row.id));
    for (const line of submitted.approvals.filter((l) => l.approverId === null)) {
      expect(ids.has(line.id)).toBe(false);
    }
  });
});
