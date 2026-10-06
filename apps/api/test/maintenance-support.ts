import type { INestApplication } from "@nestjs/common";
import {
  MaintenanceContract,
  SlaSystem,
  WorkOrder,
  type SlaSystemWrite,
} from "@ecapital/shared";
import request from "supertest";
import { expect } from "vitest";
import { USERS, bearer, tokenFor } from "./app";

/**
 * M5 helpers. Every maintenance suite makes its own agreement, its own
 * catalogue lines and its own orders, with references no other file uses,
 * so a suite never depends on what another left in the shared database
 * (ADR-0012) and never asserts a count somebody else can change (task #48).
 */
let made = 0;

/** Unique enough across one run of the suites. */
export function uniq(prefix = "T"): string {
  made += 1;
  return `${prefix}-${Date.now().toString(36)}-${made}`;
}

export async function makeContract(
  app: INestApplication,
  email: string = USERS.estatesNicosia,
  body: Record<string, unknown> = {},
): Promise<MaintenanceContract> {
  const token = await tokenFor(app, email);
  const contractors = await request(app.getHttpServer()).get("/contractors").set(bearer(token));
  expect(contractors.status).toBe(200);
  const list = (contractors.body.items ?? contractors.body) as { id: string; blacklisted: boolean }[];
  const contractor = list.find((c) => !c.blacklisted);
  const response = await request(app.getHttpServer())
    .post("/maintenance/contracts")
    .set(bearer(token))
    .send({
      orgUnitId: "nicosia-general",
      contractorId: contractor?.id,
      ref: uniq("Α.Ο"),
      titleEl: "Σύμβαση συντήρησης δοκιμής",
      startDate: "2026-01-01",
      ...body,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return MaintenanceContract.parse(response.body);
}

export async function makeSystem(
  app: INestApplication,
  contractId: string,
  body: Partial<Omit<SlaSystemWrite, "maintenanceContractId">> = {},
  email: string = USERS.estatesNicosia,
): Promise<SlaSystem> {
  const token = await tokenFor(app, email);
  const response = await request(app.getHttpServer())
    .post(`/maintenance/contracts/${contractId}/systems`)
    .set(bearer(token))
    .send({
      code: uniq("S").slice(0, 20),
      nameEl: "Σύστημα δοκιμής",
      band: "P1",
      responseHours: 0.5,
      restoreHours: 24,
      reportHours: 48,
      ...body,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return SlaSystem.parse(response.body);
}

export async function makeOrder(
  app: INestApplication,
  body: Record<string, unknown>,
  email: string = USERS.technicianNicosia,
): Promise<WorkOrder> {
  const token = await tokenFor(app, email);
  const response = await request(app.getHttpServer())
    .post("/work-orders")
    .set(bearer(token))
    .send({
      kind: "CORRECTIVE",
      source: "TECHNICAL_SERVICES",
      orgUnitId: "nicosia-general",
      titleEl: `Βλάβη δοκιμής ${uniq()}`,
      ...body,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return WorkOrder.parse(response.body);
}

export async function step(
  app: INestApplication,
  id: string,
  body: Record<string, unknown>,
  email: string = USERS.technicianNicosia,
) {
  const token = await tokenFor(app, email);
  return request(app.getHttpServer())
    .post(`/work-orders/${id}/transition`)
    .set(bearer(token))
    .send(body);
}

export async function makeAsset(
  app: INestApplication,
  body: Record<string, unknown> = {},
  email: string = USERS.estatesNicosia,
): Promise<{ id: string; tag: string; orgUnitId: string }> {
  const token = await tokenFor(app, email);
  const response = await request(app.getHttpServer())
    .post("/assets")
    .set(bearer(token))
    .send({
      orgUnitId: "nicosia-general",
      nameEl: `Πάγιο συντήρησης ${uniq()}`,
      assetClass: "HVAC",
      criticality: 2,
      ...body,
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as { id: string; tag: string; orgUnitId: string };
}

/** A binary body, for the .xlsx routes. */
export function binary(
  res: { on(event: string, listener: (chunk: Buffer) => void): unknown },
  callback: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

export const CODES = { failureCode: "LEAK", causeCode: "WEAR", remedyCode: "REPAIR" } as const;
