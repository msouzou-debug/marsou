import type { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { BREACH_ACTOR, BreachService } from "../src/permits/breach.service";
import { approvedPermit, nicosiaAreas, type AreaIds } from "./permit-support";

/**
 * R23, CAPEX-01 §6.5 — «Overrun flips it to breach and notifies the head of
 * estates and the area owner.»
 *
 * The clock is the thing under test, so the tests drive the sweep with a
 * moment they choose rather than waiting a minute for the timer. The timer
 * itself is off in tests (`NODE_ENV === "test"`), so nothing flips underneath
 * a test that is still setting itself up.
 */
describe("the overrun sweep", () => {
  let app: INestApplication;
  let breach: BreachService;
  let client: Client;
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

  async function setWindow(id: string, startHours: number, endHours: number): Promise<void> {
    await client.query(
      `update ecapital.shutdown_permit
          set planned_start = now() + make_interval(secs => $2),
              planned_end   = now() + make_interval(secs => $3)
        where id = $1`,
      [id, startHours * 3600, endHours * 3600],
    );
  }

  /** An ACTIVE permit on the theatre, whose window can then be moved. */
  async function running(what: string): Promise<string> {
    const permit = await approvedPermit(app, {
      titleEl: title(what),
      areaIds: [areas.theatre],
      activityType: "B",
    });
    await setWindow(permit.id, -2, 2);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const active = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({ to: "ACTIVE" });
    expect(active.status).toBe(200);
    return permit.id;
  }

  async function statusOf(id: string): Promise<{ status: string; breached_at: Date | null }> {
    const { rows } = await client.query(
      "select status, breached_at from ecapital.shutdown_permit where id = $1",
      [id],
    );
    return rows[0];
  }

  it("leaves a permit that is still inside its window alone", async () => {
    const id = await running("Μέσα στο παράθυρο");
    const result = await breach.sweep(new Date());
    expect(result.breached).not.toContain(id);
    expect((await statusOf(id)).status).toBe("ACTIVE");
  });

  it("flips an ACTIVE permit past its end to BREACH and stamps the moment", async () => {
    const id = await running("Υπέρβαση");
    await setWindow(id, -4, -1);
    const at = new Date();
    const result = await breach.sweep(at);
    expect(result.breached).toContain(id);

    const row = await statusOf(id);
    expect(row.status).toBe("BREACH");
    expect(row.breached_at).not.toBeNull();
    expect(Math.abs((row.breached_at as Date).getTime() - at.getTime())).toBeLessThan(2000);
  });

  it("does not move `breachedAt` on a second pass", async () => {
    const id = await running("Δεύτερο πέρασμα");
    await setWindow(id, -4, -1);
    await breach.sweep(new Date());
    const first = await statusOf(id);

    const later = new Date(Date.now() + 3_600_000);
    const second = await breach.sweep(later);
    expect(second.breached).not.toContain(id);
    const after = await statusOf(id);
    expect((after.breached_at as Date).getTime()).toBe((first.breached_at as Date).getTime());
  });

  it("writes to the head of estates and to the area's clinical owner (§6.5)", async () => {
    const id = await running("Ειδοποιήσεις");
    await setWindow(id, -4, -1);
    await breach.sweep(new Date());

    // A permit can also carry a clash warning on the same entity (§6.7), so
    // this asks for the overrun letters and not for everything about it.
    const { rows } = await client.query(
      `select to_email, subject_el, subject_en, body_el
         from ecapital.email_outbox
        where entity_type = 'shutdown_permit' and entity_id = $1
          and subject_en like 'Shutdown overrun%'`,
      [id],
    );
    expect(rows.length).toBeGreaterThan(0);
    const addresses = rows.map((row) => row.to_email).sort();
    expect(addresses).toContain("estates.nicosia@ecapital.test");
    // The theatre's clinical owner.
    expect(addresses).toContain("clinical.nicosia@ecapital.test");
    expect(rows[0].subject_el).toContain("Υπέρβαση διακοπής");
    expect(rows[0].subject_en).toContain("Shutdown overrun");
    expect(rows[0].body_el).toContain("δεν έχει παραδοθεί");
    // Nobody is told twice.
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it("records the flip in the audit log as the scheduler's (R42)", async () => {
    const id = await running("Ίχνος του χρονοπρογραμματιστή");
    await setWindow(id, -4, -1);
    await breach.sweep(new Date());

    const { rows } = await client.query(
      `select actor_id, after ->> 'status' as status
         from ecapital.audit_log
        where entity_type = 'shutdown_permit' and entity_id = $1
        order by id desc limit 1`,
      [id],
    );
    expect(rows[0].status).toBe("BREACH");
    expect(rows[0].actor_id).toBe(BREACH_ACTOR);
  });

  it("does not touch a permit that is not running", async () => {
    // APPROVED but never started, and its window has been and gone.
    const permit = await approvedPermit(app, {
      titleEl: title("Ποτέ δεν ξεκίνησε"),
      areaIds: [areas.office],
      activityType: "A",
    });
    await setWindow(permit.id, -4, -1);
    const result = await breach.sweep(new Date());
    expect(result.breached).not.toContain(permit.id);
    expect((await statusOf(permit.id)).status).toBe("APPROVED");
  });

  it("lets a breached permit still be closed (§6.6)", async () => {
    const id = await running("Κλείσιμο μετά την υπέρβαση");
    await setWindow(id, -4, -1);
    await breach.sweep(new Date());
    expect((await statusOf(id)).status).toBe("BREACH");

    const token = await tokenFor(app, USERS.clinicalNicosia);
    const closed = await request(app.getHttpServer())
      .post(`/permits/${id}/transition`)
      .set(bearer(token))
      .send({
        to: "CLOSED",
        commentEl: null,
        closeout: {
          barriersRemoved: true,
          areaCleaned: true,
          airBalanceRestored: true,
          systemsTestedAndReturned: true,
          fireSystemsReenabled: true,
          noteEl: "Καθυστέρησε η επαναφορά του αερισμού.",
          clinicalAcceptanceById: null,
          clinicalAcceptanceByName: null,
          clinicalAcceptanceAt: null,
        },
      });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("CLOSED");
    // The breach is part of the record, not something closing erases.
    expect(closed.body.breachedAt).not.toBeNull();
  });
});
