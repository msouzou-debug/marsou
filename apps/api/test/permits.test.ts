import type { INestApplication } from "@nestjs/common";
import { ShutdownPermit } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import {
  M3_USERS,
  approveEveryLine,
  approvedPermit,
  draftPermit,
  nicosiaAreas,
  runIcra,
  submit,
  type AreaIds,
} from "./permit-support";

/**
 * M3 — the permit's whole life (R19, R21–R24, CAPEX-01 §6).
 *
 * request → ICRA → ILSM → routing → clinical approval → active → closeout,
 * one `it` per rule, and one per refusal. Clinical safety: every refusal
 * here is a thing the paper form at the pilot hospital would not let somebody
 * do either.
 */
describe("shutdown permits", () => {
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

  /** Move a permit's window without going round the API. */
  async function setWindow(id: string, startHours: number, endHours: number): Promise<void> {
    await client.query(
      `update ecapital.shutdown_permit
          set planned_start = now() + make_interval(secs => $2),
              planned_end   = now() + make_interval(secs => $3)
        where id = $1`,
      [id, startHours * 3600, endHours * 3600],
    );
  }

  // ------------------------------------------------------- the request, R19 --

  it("starts DRAFT, with no reference, raised by the caller", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Αντικατάσταση καλωδίωσης"),
      areaIds: [areas.office],
    });
    expect(permit.status).toBe("DRAFT");
    expect(permit.ref).toBeNull();
    expect(permit.requestedByName).toBe("Ανδρέας Παπαδόπουλος");
    expect(permit.icra).toBeNull();
    expect(ShutdownPermit.parse(permit).affectedAreas).toHaveLength(1);
  });

  it("pulls in the whole building when the main board goes off (§6.1)", async () => {
    // The Nicosia ELECTRICAL feed has no source area: the main LV board is
    // downstream of nothing and upstream of everything.
    const permit = await draftPermit(app, {
      titleEl: title("Κεντρικός πίνακας"),
      areaIds: [areas.office],
      systems: ["ELECTRICAL"],
    });
    expect(permit.affectedAreas).toHaveLength(6);
    expect(permit.affectedAreas.filter((area) => area.impact === "DIRECT")).toHaveLength(1);
    const icu = permit.affectedAreas.find((area) => area.areaId === areas.icu);
    expect(icu?.impact).toBe("INDIRECT");
    expect(icu?.viaSystem).toBe("ELECTRICAL");
    expect(icu?.buildingCode).toBe("NGH-A");
    expect(icu?.floorCode).toBe("01");
  });

  it("works out the indirect impact from the system feeds (§6.1)", async () => {
    // The medical-gas riser starts in the plant room and feeds the ICU and
    // the theatre, so picking the plant room pulls both in.
    const permit = await draftPermit(app, {
      titleEl: title("Διακοπή ιατρικών αερίων"),
      areaIds: [areas.plant],
      systems: ["MEDICAL_GAS"],
    });
    const byId = new Map(permit.affectedAreas.map((area) => [area.areaId, area]));
    expect(byId.get(areas.plant)?.impact).toBe("DIRECT");
    expect(byId.get(areas.icu)?.impact).toBe("INDIRECT");
    expect(byId.get(areas.icu)?.viaSystem).toBe("MEDICAL_GAS");
    expect(byId.get(areas.theatre)?.impact).toBe("INDIRECT");
  });

  it("keeps DIRECT when an area is both picked and downstream", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Διακοπή αερίων με το χειρουργείο"),
      areaIds: [areas.plant, areas.theatre],
      systems: ["MEDICAL_GAS"],
    });
    const theatre = permit.affectedAreas.find((area) => area.areaId === areas.theatre);
    expect(theatre?.impact).toBe("DIRECT");
    expect(theatre?.viaSystem).toBeNull();
  });

  it("refuses a window that runs backwards", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post("/permits")
      .set(bearer(token))
      .send({
        titleEl: title("Ανάποδο παράθυρο"),
        descriptionEl: "",
        workKind: "MAINTENANCE",
        systems: ["WATER"],
        affectedAreaIds: [areas.office],
        plannedStart: "2027-03-02T10:00:00.000Z",
        plannedEnd: "2027-03-02T08:00:00.000Z",
        contingencyPlanEl: null,
        ilsmTriggers: [],
      });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitWindowBackwards");
  });

  it("refuses a technician raising one — a shutdown is the project register's", async () => {
    const token = await tokenFor(app, USERS.technicianNicosia);
    const response = await request(app.getHttpServer())
      .post("/permits")
      .set(bearer(token))
      .send({
        titleEl: title("Από τεχνίτη"),
        descriptionEl: "",
        workKind: "MAINTENANCE",
        systems: ["WATER"],
        affectedAreaIds: [areas.office],
        plannedStart: new Date(Date.now() + 86_400_000).toISOString(),
        plannedEnd: new Date(Date.now() + 90_000_000).toISOString(),
        contingencyPlanEl: null,
        ilsmTriggers: [],
      });
    expect(response.status).toBe(403);
  });

  it("edits a draft and re-resolves the impact when the systems change", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Επεξεργασία"),
      areaIds: [areas.plant],
      systems: ["WATER"],
    });
    expect(permit.affectedAreas).toHaveLength(1);

    const token = await tokenFor(app, USERS.estatesNicosia);
    const patched = await request(app.getHttpServer())
      .patch(`/permits/${permit.id}`)
      .set(bearer(token))
      .send({ systems: ["MEDICAL_GAS"] });
    expect(patched.status).toBe(200);
    expect((patched.body as ShutdownPermit).affectedAreas.length).toBeGreaterThan(1);
  });

  // ---------------------------------------------------------- the ICRA, R20 --

  it("stores the class, the controls and the matrix version it was decided under", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("ICRA στο χειρουργείο"),
      areaIds: [areas.theatre],
    });
    const after = await runIcra(app, permit.id, "C");
    expect(after.icra?.icraClass).toBe("IV");
    expect(after.icra?.riskGroup).toBe("HIGHEST");
    expect(after.icra?.matrixVersionId).toBe("OKYPY-ICRA-2.0-2026.1");
    expect(after.icra?.permitRequired).toBe(true);
    expect(after.icra?.controls.length).toBeGreaterThan(5);
  });

  it("refuses Class II for renovation — §6.2, the wizard must refuse it", async () => {
    // The office is LOW risk; activity B there is Class II.
    const permit = await draftPermit(app, {
      titleEl: title("Ανακαίνιση γραφείου"),
      areaIds: [areas.office],
      workKind: "RENOVATION",
    });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/icra`)
      .set(bearer(token))
      .send({ activityType: "B", surrounding: [], acknowledgedControlIds: [] });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.classTwoInvalidForWorks");
    expect(response.body.message).toContain("Κατηγορία");
  });

  it("refuses an ICRA whose controls nobody acknowledged (UI S12)", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Χωρίς επιβεβαίωση"),
      areaIds: [areas.office],
    });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/icra`)
      .set(bearer(token))
      .send({ activityType: "B", surrounding: [], acknowledgedControlIds: [] });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitControlsNotAcknowledged");
  });

  it("takes the risk group from the indirect areas too (§6.1, §6.2)", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Έμμεση ομάδα κινδύνου"),
      areaIds: [areas.plant],
      systems: ["MEDICAL_GAS"],
    });
    const after = await runIcra(app, permit.id, "B");
    // The plant room on its own is LOW; the ICU downstream is HIGHEST.
    expect(after.icra?.riskGroup).toBe("HIGHEST");
    expect(after.icra?.icraClass).toBe("III");
  });

  // -------------------------------------------------- submission, §6.3–§6.7 --

  it("refuses submission before the ICRA has run", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Χωρίς ICRA"),
      areaIds: [areas.office],
    });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({ to: "SUBMITTED" });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitIcraRequired");
  });

  it("allocates PTW-<UNIT>-<YEAR>-<NNN> on submission and never changes it", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Αριθμός άδειας"),
      areaIds: [areas.office],
    });
    await runIcra(app, permit.id, "A");
    const submitted = await submit(app, permit.id);
    expect(submitted.ref).toMatch(/^PTW-NGH-\d{4}-\d{3}$/);
    expect(submitted.ref).toContain(`-${new Date().getUTCFullYear()}-`);
    expect(submitted.submittedAt).not.toBeNull();
  });

  it("keeps the reference when a returned permit is submitted again", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Επιστροφή και επανυποβολή"),
      areaIds: [areas.office],
    });
    await runIcra(app, permit.id, "A");
    const submitted = await submit(app, permit.id);
    const ref = submitted.ref;

    const admin = await tokenFor(app, USERS.admin);
    const returned = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/approvals/${submitted.approvals[0].id}/decide`)
      .set(bearer(admin))
      .send({ decision: "RETURNED", commentEl: "Δώστε σχέδιο εκτάκτου ανάγκης." });
    expect(returned.status).toBe(200);
    expect((returned.body as ShutdownPermit).status).toBe("DRAFT");

    const again = await submit(app, permit.id);
    expect(again.ref).toBe(ref);
  });

  it("builds the route from the class, the areas and the duration (§6.4)", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Δρομολόγηση"),
      areaIds: [areas.plant, areas.theatre, areas.ward],
      systems: ["MEDICAL_GAS"],
    });
    await runIcra(app, permit.id, "C");
    const submitted = await submit(app, permit.id);
    expect(submitted.status).toBe("CLINICAL_REVIEW");

    const roles = submitted.approvals.map((line) => line.role);
    expect(roles).toContain("INFECTION_CONTROL");
    expect(roles).toContain("NURSING");
    expect(roles).toContain("TECHNICAL");
    expect(roles.filter((role) => role === "WARD_MANAGER").length).toBeGreaterThanOrEqual(3);

    const ic = submitted.approvals.find((line) => line.role === "INFECTION_CONTROL");
    expect(ic?.reason).toBe("classThreeOrAbove");
    expect(ic?.approverName).toBe("Γιώργος Σάββα");
    expect(ic?.decision).toBe("PENDING");
    expect(ic?.slaState).toBe("GREEN");
    expect(Date.parse(ic?.dueAt ?? "")).toBeGreaterThan(Date.now());
  });

  it("puts Safety on the route when ILSM is required, with all four measures (§6.3)", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Πυρανίχνευση"),
      areaIds: [areas.office],
      systems: ["FIRE"],
      ilsmTriggers: ["FIRE_DETECTION"],
    });
    await runIcra(app, permit.id, "A");
    const submitted = await submit(app, permit.id);
    expect(submitted.ilsm?.required).toBe(true);
    expect(submitted.ilsm?.measures).toEqual([
      "INTERIM_MEASURES_LIST",
      "FIRE_WATCH",
      "EXTRA_DRILLS",
      "NOTIFY_FIRE_OFFICER",
    ]);
    const safety = submitted.approvals.find((line) => line.role === "SAFETY");
    expect(safety?.reason).toBe("ilsmRequired");
    expect(safety?.approverName).toBe("Ανδρέας Παπαδόπουλος");
  });

  it("puts the Hospital Director on anything longer than the threshold", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Μακρά διακοπή"),
      areaIds: [areas.office],
      startInHours: 48,
      endInHours: 48 + 100,
    });
    await runIcra(app, permit.id, "A");
    const submitted = await submit(app, permit.id);
    const director = submitted.approvals.find((line) => line.role === "HOSPITAL_DIRECTOR");
    expect(director?.reason).toBe("durationAboveThreshold");
    expect(director?.approverName).toBe("Στέλιος Χατζηγεωργίου");
  });

  it("warns about a clash and submits anyway (§6.7)", async () => {
    const first = await draftPermit(app, {
      titleEl: title("Πρώτη διακοπή νερού"),
      areaIds: [areas.ward],
      systems: ["WATER"],
      startInHours: 500,
      endInHours: 508,
    });
    await runIcra(app, first.id, "A");
    await submit(app, first.id);

    const second = await draftPermit(app, {
      titleEl: title("Δεύτερη διακοπή νερού"),
      areaIds: [areas.ward],
      systems: ["WATER"],
      startInHours: 504,
      endInHours: 512,
    });
    await runIcra(app, second.id, "A");
    const submitted = await submit(app, second.id);

    expect(submitted.status).toBe("CLINICAL_REVIEW");
    expect(submitted.clashes).toHaveLength(1);
    expect(submitted.clashes[0].kind).toBe("SAME_AREA_OVERLAP");
    expect(submitted.clashes[0].otherPermitId).toBe(first.id);

    // §6.7's other half: an email to the head of estates, never a block.
    const { rows } = await client.query(
      "select to_email, subject_el from ecapital.email_outbox where entity_id = $1",
      [second.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].to_email).toBe("estates.nicosia@ecapital.test");
  });

  // ------------------------------------------------------- the decisions --

  it("lets only the resolved approver decide, or an administrator", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Ποιος αποφασίζει"),
      areaIds: [areas.theatre],
    });
    await runIcra(app, permit.id, "C");
    const submitted = await submit(app, permit.id);
    const ic = submitted.approvals.find((line) => line.role === "INFECTION_CONTROL");

    // The engineer who raised it is not the person it is waiting on.
    const engineer = await tokenFor(app, USERS.estatesNicosia);
    const refused = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/approvals/${ic?.id}/decide`)
      .set(bearer(engineer))
      .send({ decision: "APPROVED", commentEl: null });
    expect(refused.status).toBe(403);
    expect(refused.body.key).toBe("errors.permitDecisionNotYours");

    const clinical = await tokenFor(app, USERS.clinicalNicosia);
    const allowed = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/approvals/${ic?.id}/decide`)
      .set(bearer(clinical))
      .send({ decision: "APPROVED", commentEl: null });
    expect(allowed.status).toBe(200);
  });

  it("approves the permit when the last line is approved, and stamps it", async () => {
    const permit = await approvedPermit(app, {
      titleEl: title("Όλες οι γραμμές"),
      areaIds: [areas.office],
      activityType: "A",
    });
    expect(permit.status).toBe("APPROVED");
    expect(permit.approvedAt).not.toBeNull();
    expect(permit.approvals.every((line) => line.decision === "APPROVED")).toBe(true);
  });

  it("sends a returned permit back to DRAFT, keeps the comment and resets the rest", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Επιστροφή με σχόλια"),
      areaIds: [areas.theatre],
    });
    await runIcra(app, permit.id, "C");
    const submitted = await submit(app, permit.id);
    const admin = await tokenFor(app, USERS.admin);

    // Approve one line, then have another return it.
    const first = submitted.approvals[0];
    await request(app.getHttpServer())
      .post(`/permits/${permit.id}/approvals/${first.id}/decide`)
      .set(bearer(admin))
      .send({ decision: "APPROVED", commentEl: null });

    const second = submitted.approvals[1];
    const returned = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/approvals/${second.id}/decide`)
      .set(bearer(admin))
      .send({ decision: "RETURNED", commentEl: "Χρειάζεται σχέδιο εκτάκτου ανάγκης." });

    const body = returned.body as ShutdownPermit;
    expect(body.status).toBe("DRAFT");
    const returnedLine = body.approvals.find((line) => line.id === second.id);
    expect(returnedLine?.decision).toBe("RETURNED");
    expect(returnedLine?.commentEl).toBe("Χρειάζεται σχέδιο εκτάκτου ανάγκης.");
    // The approval given about the old request is not an approval of the new
    // one, so it goes back to PENDING.
    expect(body.approvals.find((line) => line.id === first.id)?.decision).toBe("PENDING");
  });

  it("refuses a return with no comment", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Επιστροφή χωρίς σχόλιο"),
      areaIds: [areas.office],
    });
    await runIcra(app, permit.id, "A");
    const submitted = await submit(app, permit.id);
    const admin = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/approvals/${submitted.approvals[0].id}/decide`)
      .set(bearer(admin))
      .send({ decision: "RETURNED", commentEl: null });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitCommentRequired");
  });

  it("rejects the permit when a line is rejected, and it is final", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Απόρριψη γραμμής"),
      areaIds: [areas.office],
    });
    await runIcra(app, permit.id, "A");
    const submitted = await submit(app, permit.id);
    const admin = await tokenFor(app, USERS.admin);
    const rejected = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/approvals/${submitted.approvals[0].id}/decide`)
      .set(bearer(admin))
      .send({ decision: "REJECTED", commentEl: "Δεν εγκρίνεται αυτή την περίοδο." });
    expect((rejected.body as ShutdownPermit).status).toBe("REJECTED");

    // A rejected permit is immutable — the trigger says so as well as the service.
    const engineer = await tokenFor(app, USERS.estatesNicosia);
    const patch = await request(app.getHttpServer())
      .patch(`/permits/${permit.id}`)
      .set(bearer(engineer))
      .send({ titleEl: "Κάτι άλλο" });
    expect(patch.status).toBe(422);
  });

  it("refuses a rejection with no reason", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Απόρριψη χωρίς λόγο"),
      areaIds: [areas.office],
    });
    await runIcra(app, permit.id, "A");
    await submit(app, permit.id);
    const admin = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(admin))
      .send({ to: "REJECTED", commentEl: null });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitCommentRequired");
  });

  // ------------------------------------------------------ active, §6.5 --

  it("goes ACTIVE only from APPROVED and only inside the window", async () => {
    const permit = await approvedPermit(app, {
      titleEl: title("Έναρξη εκτός παραθύρου"),
      areaIds: [areas.office],
      activityType: "A",
    });
    const token = await tokenFor(app, USERS.estatesNicosia);

    const tooEarly = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({ to: "ACTIVE" });
    expect(tooEarly.status).toBe(422);
    expect(tooEarly.body.key).toBe("errors.permitOutsideWindow");

    await setWindow(permit.id, -1, 4);
    const inside = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({ to: "ACTIVE" });
    expect(inside.status).toBe(200);
    const body = inside.body as ShutdownPermit;
    expect(body.status).toBe("ACTIVE");
    expect(body.actualStart).not.toBeNull();
  });

  it("refuses ACTIVE from anywhere but APPROVED", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Έναρξη από πρόχειρο"),
      areaIds: [areas.office],
    });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({ to: "ACTIVE" });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitNotApproved");
  });

  // ----------------------------------------------------- closeout, §6.6 --

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

  async function activePermitOnTheatre(what: string): Promise<ShutdownPermit> {
    const permit = await approvedPermit(app, {
      titleEl: title(what),
      areaIds: [areas.theatre],
      activityType: "B",
    });
    await setWindow(permit.id, -1, 4);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const active = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({ to: "ACTIVE" });
    return active.body as ShutdownPermit;
  }

  it("refuses a closeout with a box unticked", async () => {
    const permit = await activePermitOnTheatre("Κλείσιμο με κενό");
    const token = await tokenFor(app, USERS.clinicalNicosia);
    const response = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({
        to: "CLOSED",
        commentEl: null,
        closeout: { ...fullChecklist, fireSystemsReenabled: false },
      });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitCloseoutIncomplete");
  });

  it("refuses a closeout by somebody who is not a clinical owner of the area", async () => {
    const permit = await activePermitOnTheatre("Κλείσιμο από μηχανικό");
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({ to: "CLOSED", commentEl: null, closeout: fullChecklist });
    expect(response.status).toBe(403);
    expect(response.body.key).toBe("errors.permitAcceptanceNotYours");
  });

  it("stamps the acceptance from the caller, never from the body", async () => {
    const permit = await activePermitOnTheatre("Κλείσιμο με αποδοχή");
    const token = await tokenFor(app, USERS.clinicalNicosia);
    const response = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({
        to: "CLOSED",
        commentEl: null,
        closeout: {
          ...fullChecklist,
          // A client claiming somebody else signed it.
          clinicalAcceptanceById: "00000000-0000-0000-0000-000000000000",
          clinicalAcceptanceByName: "Κάποιος Άλλος",
          clinicalAcceptanceAt: "2020-01-01T00:00:00.000Z",
        },
      });
    expect(response.status).toBe(200);
    const body = response.body as ShutdownPermit;
    expect(body.status).toBe("CLOSED");
    expect(body.closeout?.clinicalAcceptanceByName).toBe("Γιώργος Σάββα");
    expect(body.closeout?.clinicalAcceptanceById).not.toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(Date.parse(body.closeout?.clinicalAcceptanceAt ?? "")).toBeGreaterThan(
      Date.parse("2025-01-01T00:00:00.000Z"),
    );
    expect(body.actualEnd).not.toBeNull();
    expect(body.closedAt).not.toBeNull();
  });

  it("refuses to close a permit that is not running", async () => {
    const permit = await approvedPermit(app, {
      titleEl: title("Κλείσιμο χωρίς έναρξη"),
      areaIds: [areas.theatre],
      activityType: "B",
    });
    const token = await tokenFor(app, USERS.clinicalNicosia);
    const response = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(token))
      .send({ to: "CLOSED", commentEl: null, closeout: fullChecklist });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitNotActive");
  });

  it("lets the Nursing officer sign for a ward, because the role is unit-wide", async () => {
    const permit = await approvedPermit(app, {
      titleEl: title("Αποδοχή από τη Νοσηλευτική"),
      areaIds: [areas.ward],
      activityType: "B",
    });
    await setWindow(permit.id, -1, 4);
    const engineer = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(engineer))
      .send({ to: "ACTIVE" });

    const nursing = await tokenFor(app, M3_USERS.nursingNicosia);
    const response = await request(app.getHttpServer())
      .post(`/permits/${permit.id}/transition`)
      .set(bearer(nursing))
      .send({ to: "CLOSED", commentEl: null, closeout: fullChecklist });
    expect(response.status).toBe(200);
    expect((response.body as ShutdownPermit).closeout?.clinicalAcceptanceByName).toBe(
      "Μαρίνα Αντωνίου",
    );
  });

  // ------------------------------------------------------------ the list --

  it("lists permits, filtered and paged, with the class and the area count", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get("/permits?orgUnitId=nicosia-general&status=CLINICAL_REVIEW&pageSize=100")
      .set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body.total).toBeGreaterThan(0);
    for (const row of response.body.items) {
      expect(row.status).toBe("CLINICAL_REVIEW");
      expect(row.orgUnitNameEl).toBe("Γενικό Νοσοκομείο Λευκωσίας");
      expect(row.areaCount).toBeGreaterThan(0);
    }
  });

  it("filters the list by area type and by system", async () => {
    const token = await tokenFor(app, USERS.admin);
    const theatres = await request(app.getHttpServer())
      .get("/permits?areaType=THEATRE&pageSize=100")
      .set(bearer(token));
    expect(theatres.status).toBe(200);
    expect(theatres.body.items.length).toBeGreaterThan(0);

    const gas = await request(app.getHttpServer())
      .get("/permits?system=MEDICAL_GAS&pageSize=100")
      .set(bearer(token));
    expect(gas.body.items.length).toBeGreaterThan(0);
    for (const row of gas.body.items) expect(row.systems).toContain("MEDICAL_GAS");
  });

  // ------------------------------------------------------------ the audit --

  it("records every mutation in the audit log (R42)", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Ίχνος ελέγχου"),
      areaIds: [areas.office],
    });
    await runIcra(app, permit.id, "A");
    await submit(app, permit.id);
    const { rows } = await client.query(
      "select action, actor_id from ecapital.audit_log where entity_type = 'shutdown_permit' and entity_id = $1 order by id",
      [permit.id],
    );
    expect(rows.map((row) => row.action)).toEqual(["INSERT", "UPDATE", "UPDATE"]);
    expect(rows.every((row) => row.actor_id === "dev-estates-nicosia")).toBe(true);
  });

  it("answers 404 for a permit in another unit", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Άλλη μονάδα"),
      areaIds: [areas.office],
    });
    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .get(`/permits/${permit.id}`)
      .set(bearer(larnaca));
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.permitNotFound");
  });

  it("refuses to put a permit's areas across two units", async () => {
    const token = await tokenFor(app, USERS.admin);
    const larnacaAreas = await request(app.getHttpServer())
      .get("/org-units/larnaca-general/areas")
      .set(bearer(token));
    const larnacaAreaId = larnacaAreas.body.buildings[0].floors[0].areas[0].id;
    const response = await request(app.getHttpServer())
      .post("/permits")
      .set(bearer(token))
      .send({
        titleEl: title("Δύο μονάδες"),
        descriptionEl: "",
        workKind: "MAINTENANCE",
        systems: ["WATER"],
        affectedAreaIds: [areas.office, larnacaAreaId],
        plannedStart: new Date(Date.now() + 86_400_000).toISOString(),
        plannedEnd: new Date(Date.now() + 90_000_000).toISOString(),
        contingencyPlanEl: null,
        ilsmTriggers: [],
      });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitAreasAcrossUnits");
  });

  it("approves every line of the seeded Class IV permit — the M3 definition of done", async () => {
    const token = await tokenFor(app, USERS.admin);
    const list = await request(app.getHttpServer())
      .get("/permits?orgUnitId=nicosia-general&status=CLINICAL_REVIEW&pageSize=100")
      .set(bearer(token));
    const seeded = list.body.items.find(
      (row: { titleEl: string }) =>
        row.titleEl === "Διακοπή ιατρικών αερίων για αντικατάσταση βαλβίδων",
    );
    expect(seeded).toBeDefined();
    expect(seeded.icraClass).toBe("IV");

    const detail = (
      await request(app.getHttpServer()).get(`/permits/${seeded.id}`).set(bearer(token))
    ).body as ShutdownPermit;
    const ic = detail.approvals.find((line) => line.role === "INFECTION_CONTROL");
    expect(ic?.approverName).toBe("Γιώργος Σάββα");
    expect(ic?.decision).toBe("PENDING");

    // The seeded one is left where it is — `permit-seed.test.ts` reads it and
    // S14 needs something pending in it on first run. The walk through to
    // APPROVED happens on an identical permit raised here.
    const mine = await draftPermit(app, {
      titleEl: title("Κλάση IV όπως το σπαρμένο"),
      areaIds: [areas.plant, areas.theatre],
      systems: ["MEDICAL_GAS"],
      workKind: "RENOVATION",
    });
    await runIcra(app, mine.id, "C");
    const submitted = await submit(app, mine.id);
    expect(submitted.icra?.icraClass).toBe("IV");
    const approved = await approveEveryLine(app, mine.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedAt).not.toBeNull();
  });
});

/**
 * The wizard autosaves (S11): the request is created the moment the requester
 * leaves step 1, which is before any area has been picked and before anybody
 * has said when the work happens. Reconciled with the web agent, 19/09/2026,
 * and written down in ADR-0026.
 */
describe("a draft the wizard has not finished", () => {
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

  async function step1(extra: Record<string, unknown> = {}) {
    const token = await tokenFor(app, USERS.estatesNicosia);
    return request(app.getHttpServer())
      .post("/permits")
      .set(bearer(token))
      .send({
        titleEl: title("Μόνο το πρώτο βήμα"),
        descriptionEl: "",
        workKind: "MAINTENANCE",
        systems: ["WATER"],
        ...extra,
      });
  }

  it("takes a create with no areas and no dates on it", async () => {
    const response = await step1();
    expect(response.status).toBe(201);
    const permit = ShutdownPermit.parse(response.body);
    expect(permit.status).toBe("DRAFT");
    expect(permit.affectedAreas).toEqual([]);
    // The window is a placeholder, and the contract still gets two strings.
    expect(permit.plannedStart).not.toBe("");
    expect(permit.plannedEnd).not.toBe("");
  });

  it("works out the unit from the caller when there is nothing else to go on", async () => {
    const response = await step1();
    expect((response.body as ShutdownPermit).orgUnitId).toBe("nicosia-general");
  });

  it("takes the unit from the project when the wizard picked one", async () => {
    const admin = await tokenFor(app, USERS.admin);
    const projects = await request(app.getHttpServer())
      .get("/projects?unit=larnaca-general&pageSize=1")
      .set(bearer(admin));
    const project = projects.body.items[0];
    expect(project).toBeDefined();

    const engineer = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .post("/permits")
      .set(bearer(engineer))
      .send({
        titleEl: title("Από το έργο"),
        descriptionEl: "",
        workKind: "MAINTENANCE",
        systems: ["WATER"],
        projectId: project.id,
      });
    expect(response.status).toBe(201);
    expect((response.body as ShutdownPermit).orgUnitId).toBe("larnaca-general");
  });

  it("refuses the submission of a draft with no areas on it", async () => {
    const created = await step1();
    const id = (created.body as ShutdownPermit).id;
    const token = await tokenFor(app, USERS.estatesNicosia);
    // Dates first, so the refusal is about the areas and not about them.
    await request(app.getHttpServer())
      .patch(`/permits/${id}`)
      .set(bearer(token))
      .send({
        plannedStart: new Date(Date.now() + 86_400_000).toISOString(),
        plannedEnd: new Date(Date.now() + 90_000_000).toISOString(),
      });
    const response = await request(app.getHttpServer())
      .post(`/permits/${id}/transition`)
      .set(bearer(token))
      .send({ to: "SUBMITTED" });
    expect(response.status).toBe(422);
    // The ICRA cannot have run either, and that is the first thing missing.
    expect(["errors.permitIcraRequired", "errors.permitNoAreas"]).toContain(response.body.key);
  });

  it("refuses the submission of a draft whose window is still the placeholder", async () => {
    const created = await step1();
    const id = (created.body as ShutdownPermit).id;
    const token = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .patch(`/permits/${id}`)
      .set(bearer(token))
      .send({ affectedAreaIds: [areas.office] });
    await runIcra(app, id, "A");

    const response = await request(app.getHttpServer())
      .post(`/permits/${id}/transition`)
      .set(bearer(token))
      .send({ to: "SUBMITTED" });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.permitWindowRequired");
  });

  it("submits once the later steps have filled it in", async () => {
    const created = await step1();
    const id = (created.body as ShutdownPermit).id;
    const token = await tokenFor(app, USERS.estatesNicosia);

    const withAreas = await request(app.getHttpServer())
      .patch(`/permits/${id}`)
      .set(bearer(token))
      .send({ affectedAreaIds: [areas.office] });
    expect(withAreas.status).toBe(200);
    expect((withAreas.body as ShutdownPermit).affectedAreas).toHaveLength(1);

    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(Date.now() + 90_000_000);
    const withDates = await request(app.getHttpServer())
      .patch(`/permits/${id}`)
      .set(bearer(token))
      .send({ plannedStart: start.toISOString(), plannedEnd: end.toISOString() });
    expect(withDates.status).toBe(200);
    expect((withDates.body as ShutdownPermit).plannedStart).toBe(start.toISOString());

    await runIcra(app, id, "A");
    const submitted = await submit(app, id);
    expect(submitted.status).toBe("CLINICAL_REVIEW");
    expect(submitted.ref).toMatch(/^PTW-NGH-/);
  });

  it("puts `permitClash.<KIND>` on a clash, which is the key both catalogues carry", async () => {
    const first = await draftPermit(app, {
      titleEl: title("Πρώτη σύγκρουση κλειδιού"),
      areaIds: [areas.opd],
      systems: ["WATER"],
      startInHours: 900,
      endInHours: 908,
    });
    await runIcra(app, first.id, "A");
    await submit(app, first.id);

    const second = await draftPermit(app, {
      titleEl: title("Δεύτερη σύγκρουση κλειδιού"),
      areaIds: [areas.opd],
      systems: ["WATER"],
      startInHours: 902,
      endInHours: 910,
    });
    await runIcra(app, second.id, "A");
    const submitted = await submit(app, second.id);
    expect(submitted.clashes[0].messageKey).toBe("permitClash.SAME_AREA_OVERLAP");
    expect(submitted.clashes[0].otherPermitRef).toMatch(/^PTW-NGH-/);
  });

  it("carries the project id on every list row (S03's open-permits card)", async () => {
    const admin = await tokenFor(app, USERS.admin);
    const projects = await request(app.getHttpServer())
      .get("/projects?unit=larnaca-general&pageSize=1")
      .set(bearer(admin));
    const project = projects.body.items[0];

    const engineer = await tokenFor(app, USERS.engineerLarnaca);
    const created = await request(app.getHttpServer())
      .post("/permits")
      .set(bearer(engineer))
      .send({
        titleEl: title("Με έργο για τη λίστα"),
        descriptionEl: "",
        workKind: "MAINTENANCE",
        systems: ["WATER"],
        projectId: project.id,
      });

    const list = await request(app.getHttpServer())
      .get("/permits?orgUnitId=larnaca-general&pageSize=100")
      .set(bearer(engineer));
    const row = list.body.items.find(
      (item: { id: string }) => item.id === (created.body as ShutdownPermit).id,
    );
    expect(row.projectId).toBe(project.id);
  });

  it("serves the permit's own trail in the project trail's shape (R42)", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Ίχνος άδειας"),
      areaIds: [areas.office],
    });
    await runIcra(app, permit.id, "A");
    await submit(app, permit.id);

    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get(`/permits/${permit.id}/audit`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    const entries = response.body as { action: string; actorName: string; detail: string | null }[];
    expect(entries.length).toBeGreaterThan(2);
    // Newest first, and the status move is named rather than described.
    expect(entries.map((entry) => entry.action)).toContain("permitStatusChanged");
    expect(entries.map((entry) => entry.action)).toContain("permitRaised");
    expect(entries.map((entry) => entry.action)).toContain("permitRouted");
    expect(entries[0].actorName).toBe("Ανδρέας Παπαδόπουλος");
    const moved = entries.find((entry) => entry.action === "permitStatusChanged");
    expect(moved?.detail).toContain("→");
  });

  it("answers 404 for the trail of a permit the caller cannot see", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Ίχνος άλλης μονάδας"),
      areaIds: [areas.office],
    });
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .get(`/permits/${permit.id}/audit`)
      .set(bearer(token));
    expect(response.status).toBe(404);
  });
});
