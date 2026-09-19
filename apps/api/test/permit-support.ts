import type { INestApplication } from "@nestjs/common";
import type { AreaTree, ShutdownPermit } from "@ecapital/shared";
import request from "supertest";
import { USERS, bearer, tokenFor } from "./app";

/**
 * Fixtures the M3 suites build for themselves rather than borrow from the
 * seed. The seeded permits are a demo register other suites read; a test that
 * needs a permit in a known state builds its own so it cannot be surprised.
 */

export const M3_USERS = {
  ...USERS,
  nursingNicosia: "nursing.nicosia@ecapital.test",
  directorNicosia: "director.nicosia@ecapital.test",
} as const;

export interface AreaIds {
  opd: string;
  plant: string;
  office: string;
  theatre: string;
  icu: string;
  ward: string;
}

/** The six seeded Nicosia areas, by the code the fixture in seed-data gives them. */
export async function nicosiaAreas(app: INestApplication): Promise<AreaIds> {
  const token = await tokenFor(app, USERS.admin);
  const response = await request(app.getHttpServer())
    .get("/org-units/nicosia-general/areas")
    .set(bearer(token));
  const tree = response.body as AreaTree;
  const byCode = new Map(
    tree.buildings.flatMap((b) => b.floors.flatMap((f) => f.areas.map((a) => [a.code, a.id]))),
  );
  const pick = (code: string): string => {
    const id = byCode.get(code);
    if (!id) throw new Error(`no seeded Nicosia area ${code}`);
    return id;
  };
  return {
    opd: pick("OPD-01"),
    plant: pick("PLT-01"),
    office: pick("OFF-01"),
    theatre: pick("THE-01"),
    icu: pick("ICU-01"),
    ward: pick("WRD-01"),
  };
}

const HOUR_MS = 3_600_000;

export interface DraftOptions {
  titleEl: string;
  areaIds: string[];
  systems?: ShutdownPermit["systems"];
  workKind?: ShutdownPermit["workKind"];
  startInHours?: number;
  endInHours?: number;
  ilsmTriggers?: NonNullable<ShutdownPermit["ilsm"]>["triggers"];
  email?: string;
}

/** A DRAFT permit, straight from POST /permits. */
export async function draftPermit(
  app: INestApplication,
  options: DraftOptions,
): Promise<ShutdownPermit> {
  const token = await tokenFor(app, options.email ?? USERS.estatesNicosia);
  const now = Date.now();
  const response = await request(app.getHttpServer())
    .post("/permits")
    .set(bearer(token))
    .send({
      titleEl: options.titleEl,
      descriptionEl: "Δοκιμαστική διακοπή για τους ελέγχους.",
      workKind: options.workKind ?? "MAINTENANCE",
      // WATER on purpose: Nicosia has no WATER feed, so a fixture that does
      // not care about indirect impact gets exactly the areas it asked for.
      systems: options.systems ?? ["WATER"],
      affectedAreaIds: options.areaIds,
      plannedStart: new Date(now + (options.startInHours ?? 48) * HOUR_MS).toISOString(),
      plannedEnd: new Date(now + (options.endInHours ?? 52) * HOUR_MS).toISOString(),
      contingencyPlanEl: "Εφεδρική τροφοδοσία σε όλη τη διάρκεια.",
      ilsmTriggers: options.ilsmTriggers ?? [],
    });
  if (response.status !== 201) {
    throw new Error(`draftPermit: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body as ShutdownPermit;
}

/** The ICRA step, acknowledging every control the engine answers with. */
export async function runIcra(
  app: INestApplication,
  permitId: string,
  activityType: "A" | "B" | "C" | "D",
  email: string = USERS.estatesNicosia,
): Promise<ShutdownPermit> {
  const token = await tokenFor(app, email);
  const permit = await request(app.getHttpServer())
    .get(`/permits/${permitId}`)
    .set(bearer(token));
  const body = permit.body as ShutdownPermit;

  const evaluated = await request(app.getHttpServer())
    .post("/icra/evaluate")
    .set(bearer(token))
    .send({
      activityType,
      affectedAreaIds: body.affectedAreas.map((area) => area.areaId),
      surrounding: [],
      workKind: body.workKind,
    });

  const response = await request(app.getHttpServer())
    .post(`/permits/${permitId}/icra`)
    .set(bearer(token))
    .send({
      activityType,
      surrounding: [],
      acknowledgedControlIds: (evaluated.body.controls ?? []).map(
        (control: { id: string }) => control.id,
      ),
    });
  if (response.status !== 200) {
    throw new Error(`runIcra: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body as ShutdownPermit;
}

export async function submit(
  app: INestApplication,
  permitId: string,
  email: string = USERS.estatesNicosia,
): Promise<ShutdownPermit> {
  const token = await tokenFor(app, email);
  const response = await request(app.getHttpServer())
    .post(`/permits/${permitId}/transition`)
    .set(bearer(token))
    .send({ to: "SUBMITTED" });
  if (response.status !== 200) {
    throw new Error(`submit: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body as ShutdownPermit;
}

/** Approve every line, each as the person it is waiting on. */
export async function approveEveryLine(
  app: INestApplication,
  permitId: string,
): Promise<ShutdownPermit> {
  const adminToken = await tokenFor(app, USERS.admin);
  let permit = (
    await request(app.getHttpServer()).get(`/permits/${permitId}`).set(bearer(adminToken))
  ).body as ShutdownPermit;

  for (const line of permit.approvals) {
    if (line.decision !== "PENDING") continue;
    const response = await request(app.getHttpServer())
      .post(`/permits/${permitId}/approvals/${line.id}/decide`)
      .set(bearer(adminToken))
      .send({ decision: "APPROVED", commentEl: null });
    if (response.status !== 200) {
      throw new Error(`approve: ${response.status} ${JSON.stringify(response.body)}`);
    }
    permit = response.body as ShutdownPermit;
  }
  return permit;
}

/** DRAFT → ICRA → SUBMITTED → every line approved. */
export async function approvedPermit(
  app: INestApplication,
  options: DraftOptions & { activityType?: "A" | "B" | "C" | "D" },
): Promise<ShutdownPermit> {
  const draft = await draftPermit(app, options);
  await runIcra(app, draft.id, options.activityType ?? "B", options.email);
  await submit(app, draft.id, options.email);
  return approveEveryLine(app, draft.id);
}

export function permitOf(app: INestApplication, id: string, email: string) {
  return tokenFor(app, email).then((token) =>
    request(app.getHttpServer()).get(`/permits/${id}`).set(bearer(token)),
  );
}
