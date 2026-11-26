import type { INestApplication } from "@nestjs/common";
import type { AuditEntry, Inbox, ShutdownPermit } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { BreachService } from "../src/permits/breach.service";
import {
  M3_USERS,
  approvedPermit,
  nicosiaAreas,
  permitOf,
  type AreaIds,
} from "./permit-support";

/**
 * OWNER 26/11/2026 — the permit is closed in two steps (§6.6, 0035).
 *
 * UAT found that nobody could close a permit from the screen: the button was
 * the works side's and the signature the clinical owner's. Now the works side
 * ticks the checklist and submits the area for acceptance, and the clinical
 * owner accepts it (and the permit closes, signed with their own id) or
 * returns it with a comment. Every refusal below is one the paper handback
 * at the pilot hospital would make too.
 */
describe("the permit handback in two steps", () => {
  let app: INestApplication;
  let client: Client;
  let breach: BreachService;
  let areas: AreaIds;
  let stamp = 0;

  beforeAll(async () => {
    app = await createTestApp();
    breach = app.get(BreachService);
    client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
    areas = await nicosiaAreas(app);
  });
  afterAll(async () => {
    await client.end();
    await app.close();
  });

  const title = (what: string) => `${what} ${Date.now()}-${(stamp += 1)}`;

  const fullChecklist = {
    barriersRemoved: true,
    areaCleaned: true,
    airBalanceRestored: true,
    systemsTestedAndReturned: true,
    fireSystemsReenabled: true,
    noteEl: "Ο χώρος παραδόθηκε καθαρός.",
    clinicalAcceptanceById: null,
    clinicalAcceptanceByName: null,
    clinicalAcceptanceAt: null,
  };

  async function setWindow(id: string, startHours: number, endHours: number): Promise<void> {
    await client.query(
      `update ecapital.shutdown_permit
          set planned_start = now() + make_interval(secs => $2),
              planned_end   = now() + make_interval(secs => $3)
        where id = $1`,
      [id, startHours * 3600, endHours * 3600],
    );
  }

  /** ACTIVE, on an area the clinical owner of Λευκωσία owns. */
  async function running(what: string, areaId: string = areas.theatre): Promise<ShutdownPermit> {
    const permit = await approvedPermit(app, { titleEl: title(what), areaIds: [areaId], activityType: "B" });
    await setWindow(permit.id, -1, 4);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const active = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({ to: "ACTIVE" });
    expect(active.status).toBe(200);
    return active.body as ShutdownPermit;
  }

  async function submitCloseout(id: string, email: string, closeout: object = fullChecklist) {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer())
      .post(`/permits/${id}/closeout`)
      .set(bearer(token))
      .send({ closeout });
  }

  async function accept(id: string, email: string, body: object = { to: "CLOSED", commentEl: null }) {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer()).post(`/permits/${id}/transition`).set(bearer(token)).send(body);
  }

  async function giveBack(id: string, email: string, commentEl: string) {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer())
      .post(`/permits/${id}/closeout/return`)
      .set(bearer(token))
      .send({ commentEl });
  }

  async function inboxOf(email: string): Promise<Inbox> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer()).get("/inbox").set(bearer(token));
    expect(response.status).toBe(200);
    return response.body as Inbox;
  }

  // ------------------------------------------------------------- step 1 --

  it("lets the works side submit the area: still ACTIVE, the works ended, nobody signed yet", async () => {
    const permit = await running("Υποβολή για αποδοχή");
    const response = await submitCloseout(permit.id, USERS.estatesNicosia, {
      ...fullChecklist,
      // A client claiming the clinical owner already signed.
      clinicalAcceptanceById: "00000000-0000-0000-0000-000000000000",
      clinicalAcceptanceByName: "Κάποιος Άλλος",
      clinicalAcceptanceAt: "2020-01-01T00:00:00.000Z",
    });
    expect(response.status).toBe(200);
    const body = response.body as ShutdownPermit;
    expect(body.status).toBe("ACTIVE");
    expect(body.handback.submittedAt).not.toBeNull();
    expect(body.handback.submittedByName).toBe("Ανδρέας Παπαδόπουλος");
    expect(body.actualEnd).not.toBeNull();
    expect(body.closeout?.barriersRemoved).toBe(true);
    expect(body.closeout?.clinicalAcceptanceById).toBeNull();
    expect(body.closeout?.clinicalAcceptanceByName).toBeNull();
    // The engineer does not hold the acceptance; the clinical owner does.
    expect(body.handback.mayAccept).toBe(false);
    const asClinical = await permitOf(app, permit.id, USERS.clinicalNicosia);
    expect((asClinical.body as ShutdownPermit).handback.mayAccept).toBe(true);
  });

  it("lets an administrator submit the area as well (permitOperate WRITE)", async () => {
    const permit = await running("Υποβολή από διαχειριστή", areas.office);
    const response = await submitCloseout(permit.id, USERS.admin);
    expect(response.status).toBe(200);
    expect((response.body as ShutdownPermit).handback.submittedAt).not.toBeNull();
  });

  it("refuses a submission with a box unticked", async () => {
    const permit = await running("Υποβολή με κενό");
    const response = await submitCloseout(permit.id, USERS.estatesNicosia, {
      ...fullChecklist,
      fireSystemsReenabled: false,
    });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitCloseoutIncomplete");
  });

  it("refuses a submission from a clinical approver, who does not run the works", async () => {
    const permit = await running("Υποβολή από κλινικό");
    const response = await submitCloseout(permit.id, USERS.clinicalNicosia);
    expect(response.status).toBe(403);
  });

  it("refuses a second submission while the first is waiting", async () => {
    const permit = await running("Διπλή υποβολή");
    expect((await submitCloseout(permit.id, USERS.estatesNicosia)).status).toBe(200);
    const again = await submitCloseout(permit.id, USERS.estatesNicosia);
    expect(again.status).toBe(422);
    expect(again.body.key).toBe("errors.permitHandbackPending");
  });

  it("refuses a submission on a permit that is not running", async () => {
    const permit = await approvedPermit(app, {
      titleEl: title("Υποβολή χωρίς έναρξη"),
      areaIds: [areas.theatre],
      activityType: "B",
    });
    const response = await submitCloseout(permit.id, USERS.estatesNicosia);
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitNotActive");
  });

  // ------------------------------------------------------------- step 2 --

  it("refuses the acceptance before anything was submitted", async () => {
    const permit = await running("Αποδοχή χωρίς υποβολή");
    const response = await accept(permit.id, USERS.clinicalNicosia, {
      to: "CLOSED",
      commentEl: null,
      closeout: fullChecklist,
    });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitHandbackNotSubmitted");
  });

  it("refuses the acceptance from the engineer and from an administrator", async () => {
    const permit = await running("Αποδοχή από μη κλινικό");
    expect((await submitCloseout(permit.id, USERS.estatesNicosia)).status).toBe(200);

    const engineer = await accept(permit.id, USERS.estatesNicosia);
    expect(engineer.status).toBe(403);
    expect(engineer.body.key).toBe("errors.permitAcceptanceNotYours");

    // «including an administrator»: the acceptance is a clinical signature.
    const admin = await accept(permit.id, USERS.admin);
    expect(admin.status).toBe(403);
    expect(admin.body.key).toBe("errors.permitAcceptanceNotYours");
    const adminReturn = await giveBack(permit.id, USERS.admin, "Δεν είναι καθαρό.");
    expect(adminReturn.status).toBe(403);
    const asAdmin = await permitOf(app, permit.id, USERS.admin);
    expect((asAdmin.body as ShutdownPermit).handback.mayAccept).toBe(false);
  });

  it("stamps the acceptance from the caller, never from the body, and closes", async () => {
    const permit = await running("Αποδοχή και κλείσιμο");
    const submitted = (await submitCloseout(permit.id, USERS.estatesNicosia)).body as ShutdownPermit;

    const response = await accept(permit.id, USERS.clinicalNicosia, {
      to: "CLOSED",
      commentEl: null,
      closeout: {
        ...fullChecklist,
        clinicalAcceptanceById: "00000000-0000-0000-0000-000000000000",
        clinicalAcceptanceByName: "Κάποιος Άλλος",
        clinicalAcceptanceAt: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(response.status).toBe(200);
    const body = response.body as ShutdownPermit;
    expect(body.status).toBe("CLOSED");
    expect(body.closeout?.clinicalAcceptanceByName).toBe("Γιώργος Σάββα");
    expect(body.closeout?.clinicalAcceptanceById).not.toBe("00000000-0000-0000-0000-000000000000");
    expect(Date.parse(body.closeout?.clinicalAcceptanceAt ?? "")).toBeGreaterThan(
      Date.parse("2025-01-01T00:00:00.000Z"),
    );
    // The note is the one submitted, and the works ended when they were submitted.
    expect(body.closeout?.noteEl).toBe(fullChecklist.noteEl);
    expect(body.actualEnd).toBe(submitted.actualEnd);
    expect(body.closedAt).not.toBeNull();
    expect(body.closedById).toBe(body.closeout?.clinicalAcceptanceById);
  });

  it("lets the Nursing officer accept for a ward, because the role is unit-wide", async () => {
    const permit = await running("Αποδοχή από τη Νοσηλευτική", areas.ward);
    expect((await submitCloseout(permit.id, USERS.estatesNicosia)).status).toBe(200);
    const response = await accept(permit.id, M3_USERS.nursingNicosia);
    expect(response.status).toBe(200);
    expect((response.body as ShutdownPermit).closeout?.clinicalAcceptanceByName).toBe("Μαρίνα Αντωνίου");
  });

  it("shows a unit-wide Nursing officer a handback on a room they have no line on, and only that", async () => {
    // An office: Class A, a TECHNICAL line and nothing clinical, so §9's
    // read rule hid it from the Nursing officer, who is nevertheless the
    // person who signs its handback for the hospital (0035).
    const permit = await running("Παράδοση γραφείου στη Νοσηλευτική", areas.office);
    expect((await permitOf(app, permit.id, M3_USERS.nursingNicosia)).status).toBe(404);

    expect((await submitCloseout(permit.id, USERS.estatesNicosia)).status).toBe(200);
    const waiting = await permitOf(app, permit.id, M3_USERS.nursingNicosia);
    expect(waiting.status).toBe(200);
    expect((waiting.body as ShutdownPermit).handback.mayAccept).toBe(true);
    expect((waiting.body as ShutdownPermit).affectedAreas).toHaveLength(1);
    const inbox = await inboxOf(M3_USERS.nursingNicosia);
    expect(inbox.items.some((item) => item.id.startsWith(`handback:${permit.id}:`))).toBe(true);

    const closed = await accept(permit.id, M3_USERS.nursingNicosia);
    expect(closed.status).toBe(200);
    expect((closed.body as ShutdownPermit).closeout?.clinicalAcceptanceByName).toBe("Μαρίνα Αντωνίου");
    // What they signed stays readable to them.
    expect((await permitOf(app, permit.id, M3_USERS.nursingNicosia)).status).toBe(200);

    // A running office permit with no handback stays out of their sight.
    const other = await running("Γραφείο χωρίς παράδοση", areas.office);
    expect((await permitOf(app, other.id, M3_USERS.nursingNicosia)).status).toBe(404);
  });

  it("refuses the clinical owner of another unit", async () => {
    // Λάρνακα's theatre, raised and run by the Larnaca engineer. The clinical
    // owner of Λευκωσία's theatre has nothing to sign there: the permit does
    // not even exist for them (§9's narrow read).
    const admin = await tokenFor(app, USERS.admin);
    const tree = await request(app.getHttpServer())
      .get("/org-units/larnaca-general/areas")
      .set(bearer(admin));
    const office = tree.body.buildings
      .flatMap((b: { floors: { areas: { code: string; id: string }[] }[] }) => b.floors)
      .flatMap((f: { areas: { code: string; id: string }[] }) => f.areas)
      .find((a: { code: string }) => a.code === "OFF-01") ??
      tree.body.buildings[0].floors[0].areas[0];
    const permit = await approvedPermit(app, {
      titleEl: title("Λάρνακα, άλλη μονάδα"),
      areaIds: [office.id],
      activityType: "A",
      email: USERS.engineerLarnaca,
    });
    await setWindow(permit.id, -1, 4);
    const engineer = await tokenFor(app, USERS.engineerLarnaca);
    const active = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(engineer))
      .send({ to: "ACTIVE" });
    expect(active.status).toBe(200);
    expect((await submitCloseout(permit.id, USERS.engineerLarnaca)).status).toBe(200);

    const response = await accept(permit.id, USERS.clinicalNicosia);
    expect(response.status).toBe(404);
    expect((await giveBack(permit.id, USERS.clinicalNicosia, "Όχι.")).status).toBe(404);
    const stillWaiting = await permitOf(app, permit.id, USERS.engineerLarnaca);
    expect((stillWaiting.body as ShutdownPermit).status).toBe("ACTIVE");
    expect((stillWaiting.body as ShutdownPermit).handback.submittedAt).not.toBeNull();
  });

  // ------------------------------------------------------------ returning --

  it("returns the handback with a comment: back with the works side, in their inbox, in the trail", async () => {
    const permit = await running("Επιστροφή παράδοσης");
    expect((await submitCloseout(permit.id, USERS.estatesNicosia)).status).toBe(200);

    // The clinical owner sees it waiting on them.
    const before = await inboxOf(USERS.clinicalNicosia);
    const waiting = before.items.find((item) => item.href === `/permits/${permit.id}` && item.id.startsWith("handback:"));
    expect(waiting).toBeDefined();
    expect(waiting?.decidable).toBe(false);
    expect(waiting?.facts).toHaveLength(3);
    expect(waiting?.requestedByName).toBe("Ανδρέας Παπαδόπουλος");

    // A comment is required, and only the clinical owner may return it.
    const blank = await giveBack(permit.id, USERS.clinicalNicosia, "   ");
    expect(blank.status).toBe(422);
    expect(blank.body.key).toBe("errors.permitCommentRequired");
    const byEngineer = await giveBack(permit.id, USERS.estatesNicosia, "Επιστρέφω τη δική μου.");
    expect(byEngineer.status).toBe(403);

    const comment = "Υπάρχει σκόνη στους αεραγωγούς. Καθαρίστε ξανά.";
    const response = await giveBack(permit.id, USERS.clinicalNicosia, comment);
    expect(response.status).toBe(200);
    const body = response.body as ShutdownPermit;
    expect(body.status).toBe("ACTIVE");
    expect(body.handback.submittedAt).toBeNull();
    expect(body.handback.returnCommentEl).toBe(comment);
    expect(body.handback.returnedByName).toBe("Γιώργος Σάββα");
    expect(body.closeout).toBeNull();
    expect(body.actualEnd).toBeNull();

    // Gone from the clinical owner's inbox, in the submitter's with the comment.
    const after = await inboxOf(USERS.clinicalNicosia);
    expect(after.items.some((item) => item.href === `/permits/${permit.id}` && item.id.startsWith("handback:"))).toBe(false);
    const submitterInbox = await inboxOf(USERS.estatesNicosia);
    const returned = submitterInbox.items.find(
      (item) => item.href === `/permits/${permit.id}` && item.id.startsWith("handback-returned:"),
    );
    expect(returned?.facts[0].value).toBe(comment);

    // The trail keeps both steps and the reason.
    const token = await tokenFor(app, USERS.estatesNicosia);
    const trail = (await request(app.getHttpServer()).get(`/permits/${permit.id}/audit`).set(bearer(token)))
      .body as AuditEntry[];
    expect(trail.map((entry) => entry.action)).toContain("permitHandbackSubmitted");
    expect(trail.find((entry) => entry.action === "permitHandbackReturned")?.detail).toBe(comment);

    // Submitted again, accepted, closed.
    expect((await submitCloseout(permit.id, USERS.estatesNicosia)).status).toBe(200);
    const again = await inboxOf(USERS.estatesNicosia);
    expect(again.items.some((item) => item.id.startsWith(`handback-returned:${permit.id}`))).toBe(false);
    const closed = await accept(permit.id, USERS.clinicalNicosia);
    expect(closed.status).toBe(200);
    expect((closed.body as ShutdownPermit).status).toBe("CLOSED");
  });

  // ------------------------------------------------------------ the clock --

  it("keeps the breach sweep off a permit whose handback is waiting", async () => {
    const permit = await running("Αναμονή αποδοχής μετά τη λήξη");
    expect((await submitCloseout(permit.id, USERS.estatesNicosia)).status).toBe(200);
    await setWindow(permit.id, -4, -1);
    const result = await breach.sweep(new Date());
    expect(result.breached).not.toContain(permit.id);
    const { rows } = await client.query("select status from ecapital.shutdown_permit where id = $1", [permit.id]);
    expect(rows[0].status).toBe("ACTIVE");

    // Returned after its end: the works side's clock again, so it flips.
    expect((await giveBack(permit.id, USERS.clinicalNicosia, "Λείπει ο έλεγχος πυρασφάλειας.")).status).toBe(200);
    const next = await breach.sweep(new Date());
    expect(next.breached).toContain(permit.id);
  });

  it("keeps a permit in BREACH while its handback waits, and returns it to BREACH", async () => {
    const permit = await running("Υποβολή μετά την υπέρβαση");
    await setWindow(permit.id, -4, -1);
    await breach.sweep(new Date());
    expect((await submitCloseout(permit.id, USERS.estatesNicosia)).status).toBe(200);
    const waiting = await permitOf(app, permit.id, USERS.estatesNicosia);
    expect((waiting.body as ShutdownPermit).status).toBe("BREACH");

    const returned = await giveBack(permit.id, USERS.clinicalNicosia, "Ο χώρος δεν είναι έτοιμος.");
    expect((returned.body as ShutdownPermit).status).toBe("BREACH");
    expect((await submitCloseout(permit.id, USERS.estatesNicosia)).status).toBe(200);
    const closed = await accept(permit.id, USERS.clinicalNicosia);
    expect((closed.body as ShutdownPermit).status).toBe("CLOSED");
    // The breach is part of the record, not something closing erases.
    expect((closed.body as ShutdownPermit).breachedAt).not.toBeNull();
  });
});
