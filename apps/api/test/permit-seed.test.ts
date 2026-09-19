import type { INestApplication } from "@nestjs/common";
import type { PermitListRow, ShutdownPermit } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * CAPEX-01 §15: «Seed data ships … 5 permits at different states so every
 * screen has something in it on first run.» M3 ships eight — six at Λευκωσία
 * across the states S11–S14 have to draw, plus the two at Λάρνακα that clash
 * with each other on the same system (§6.7).
 *
 * NO PATIENT DATA: this suite also checks that, because the seed is the one
 * place somebody could put a name into the system by hand.
 */
describe("the seeded permit register", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function seededRows(): Promise<PermitListRow[]> {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get("/permits?pageSize=100")
      .set(bearer(token));
    expect(response.status).toBe(200);
    return (response.body.items as PermitListRow[]).filter((row) => SEEDED.has(row.titleEl));
  }

  const SEEDED = new Set([
    "Αντικατάσταση φωτιστικών στα εξωτερικά ιατρεία",
    "Διακοπή ιατρικών αερίων για αντικατάσταση βαλβίδων",
    "Καθαρισμός αεραγωγών χειρουργείου",
    "Επισκευή δικτύου νερού στον θάλαμο Α1",
    "Έλεγχος πυρανίχνευσης στα γραφεία",
    "Αντικατάσταση πίνακα στο μηχανοστάσιο",
    "Διακοπή ιατρικών αερίων για δοκιμή πίεσης",
    "Αντικατάσταση ρυθμιστή ιατρικών αερίων",
  ]);

  it("ships eight permits across every state a screen has to draw", async () => {
    const rows = await seededRows();
    expect(rows).toHaveLength(8);
    const statuses = rows.map((row) => row.status).sort();
    expect(statuses).toEqual(
      ["ACTIVE", "APPROVED", "BREACH", "CLINICAL_REVIEW", "CLINICAL_REVIEW", "CLINICAL_REVIEW", "CLOSED", "DRAFT"].sort(),
    );
  });

  it("gives every submitted permit a PTW reference and leaves the draft without one", async () => {
    const rows = await seededRows();
    for (const row of rows) {
      if (row.status === "DRAFT") expect(row.ref).toBeNull();
      else expect(row.ref).toMatch(/^PTW-(NGH|LAR)-\d{4}-\d{3}$/);
    }
  });

  it("puts the Class IV medical-gas permit in clinical review, waiting on Infection Control", async () => {
    const token = await tokenFor(app, USERS.admin);
    const rows = await seededRows();
    const classFour = rows.find(
      (row) => row.titleEl === "Διακοπή ιατρικών αερίων για αντικατάσταση βαλβίδων",
    );
    expect(classFour?.status).toBe("CLINICAL_REVIEW");
    expect(classFour?.icraClass).toBe("IV");
    expect(classFour?.highestRiskGroup).toBe("HIGHEST");
    expect(classFour?.pendingApprovals).toBeGreaterThan(0);

    const detail = (
      await request(app.getHttpServer()).get(`/permits/${classFour?.id}`).set(bearer(token))
    ).body as ShutdownPermit;

    // The M3 definition of done: a real Class IV permit touching a Nicosia
    // theatre and the ICU, with clinical.nicosia on it.
    const types = detail.affectedAreas.map((area) => area.areaType);
    expect(types).toContain("THEATRE");
    expect(types).toContain("ICU");
    expect(detail.affectedAreas.some((area) => area.impact === "INDIRECT")).toBe(true);

    const waitingOn = detail.approvals
      .filter((line) => line.decision === "PENDING")
      .map((line) => line.approverName);
    expect(waitingOn).toContain("Γιώργος Σάββα");
    expect(detail.approvals.map((line) => line.role)).toContain("INFECTION_CONTROL");
  });

  it("puts a clash on the second Larnaca medical-gas permit (§6.7)", async () => {
    const token = await tokenFor(app, USERS.admin);
    const rows = await seededRows();
    const second = rows.find((row) => row.titleEl === "Αντικατάσταση ρυθμιστή ιατρικών αερίων");
    const detail = (
      await request(app.getHttpServer()).get(`/permits/${second?.id}`).set(bearer(token))
    ).body as ShutdownPermit;
    expect(detail.clashes.length).toBeGreaterThan(0);
    expect(detail.clashes[0].messageKey).toMatch(/^permitClash\./);
    expect(detail.orgUnitId).toBe("larnaca-general");
  });

  it("ships the ILSM permit with the four mandatory measures and a Safety line", async () => {
    const token = await tokenFor(app, USERS.admin);
    const rows = await seededRows();
    const fire = rows.find((row) => row.titleEl === "Έλεγχος πυρανίχνευσης στα γραφεία");
    const detail = (
      await request(app.getHttpServer()).get(`/permits/${fire?.id}`).set(bearer(token))
    ).body as ShutdownPermit;
    expect(detail.ilsm?.required).toBe(true);
    expect(detail.ilsm?.measures).toHaveLength(4);
    expect(detail.approvals.map((line) => line.role)).toContain("SAFETY");
    expect(detail.status).toBe("BREACH");
    expect(detail.breachedAt).not.toBeNull();
  });

  it("ships a closed permit with every box ticked and an acceptance on it", async () => {
    const token = await tokenFor(app, USERS.admin);
    const rows = await seededRows();
    const closed = rows.find((row) => row.titleEl === "Αντικατάσταση πίνακα στο μηχανοστάσιο");
    const detail = (
      await request(app.getHttpServer()).get(`/permits/${closed?.id}`).set(bearer(token))
    ).body as ShutdownPermit;
    expect(detail.status).toBe("CLOSED");
    expect(detail.closeout?.barriersRemoved).toBe(true);
    expect(detail.closeout?.fireSystemsReenabled).toBe(true);
    expect(detail.closeout?.clinicalAcceptanceByName).not.toBeNull();
    expect(detail.actualStart).not.toBeNull();
    expect(detail.actualEnd).not.toBeNull();
  });

  it("ships an approved permit whose window starts tomorrow", async () => {
    const rows = await seededRows();
    const approved = rows.find(
      (row) => row.titleEl === "Καθαρισμός αεραγωγών χειρουργείου",
    );
    expect(approved).toBeDefined();
    expect(approved?.status).toBe("APPROVED");
    const startsIn = Date.parse(approved!.plannedStart) - Date.now();
    expect(startsIn).toBeGreaterThan(0);
    expect(startsIn).toBeLessThan(3 * 86_400_000);
  });

  it("ships the system feeds for Nicosia and Larnaca", async () => {
    const token = await tokenFor(app, USERS.admin);
    for (const [unit, atLeast] of [
      ["nicosia-general", 3],
      ["larnaca-general", 2],
    ] as const) {
      const response = await request(app.getHttpServer())
        .get(`/system-feeds?orgUnitId=${unit}`)
        .set(bearer(token));
      expect(response.body.length).toBeGreaterThanOrEqual(atLeast);
    }
  });

  it("ships the approver appointments the routing needs", async () => {
    const token = await tokenFor(app, USERS.admin);
    // Every seeded Nicosia role resolves to somebody: no unassigned line on
    // the definition-of-done permit.
    const rows = await seededRows();
    const classFour = rows.find(
      (row) => row.titleEl === "Διακοπή ιατρικών αερίων για αντικατάσταση βαλβίδων",
    );
    const detail = (
      await request(app.getHttpServer()).get(`/permits/${classFour?.id}`).set(bearer(token))
    ).body as ShutdownPermit;
    expect(detail.approvals.every((line) => line.approverId !== null)).toBe(true);
    const names = new Set(detail.approvals.map((line) => line.approverName));
    expect(names).toContain("Γιώργος Σάββα");
    expect(names).toContain("Μαρίνα Αντωνίου");
    expect(names).toContain("Ανδρέας Παπαδόπουλος");
  });

  it("puts no patient data anywhere in the permit register (CAPEX-01 §12)", async () => {
    const token = await tokenFor(app, USERS.admin);
    const rows = await seededRows();
    for (const row of rows) {
      const detail = (
        await request(app.getHttpServer()).get(`/permits/${row.id}`).set(bearer(token))
      ).body as ShutdownPermit;
      const text = JSON.stringify(detail);
      // The only people named on a permit are staff, by their role on it.
      for (const word of ["ασθεν", "διάγνωσ", "περιστατικ", "ΑΜΚΑ", "ταυτότητ"]) {
        expect(text.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });
});
