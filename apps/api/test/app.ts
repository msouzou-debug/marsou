import type { INestApplication } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { CONFIG, loadConfig, type AppConfig } from "../src/config";
import { DIRECTORY, type Directory } from "../src/auth/directory";
import { DEV_AUDIENCE, DEV_ISSUER, signSessionToken } from "../src/auth/tokens";
import { ProjectSummary, TokenClaims } from "@ecapital/shared";

export { DEV_AUDIENCE, DEV_ISSUER };

/** The eight seeded development users, by the address they sign in with. */
export const USERS = {
  admin: "admin@ecapital.test",
  estatesNicosia: "estates.nicosia@ecapital.test",
  engineerLarnaca: "engineer.larnaca@ecapital.test",
  clinicalNicosia: "clinical.nicosia@ecapital.test",
  technicianNicosia: "technician.nicosia@ecapital.test",
  finance: "finance@ecapital.test",
  auditor: "auditor@ecapital.test",
  executive: "executive@ecapital.test",
} as const;

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return withoutTimers(app);
}

/**
 * Takes the application's `@Interval` timers off — the eFinance push retry and
 * sync, the permit breach sweep, the eArchive drain. Each tick already returns
 * at once under NODE_ENV=test; this is the second lock, so a timer can never
 * act on the shared database in the middle of somebody else's test however
 * long a run takes. A test that wants a pass calls the service itself
 * (`retryPending`, `sweep`, `drain`) for the rows it owns.
 */
export function withoutTimers(app: INestApplication): INestApplication {
  const registry = app.get(SchedulerRegistry);
  for (const name of registry.getIntervals()) registry.deleteInterval(name);
  for (const name of registry.getTimeouts()) registry.deleteTimeout(name);
  for (const [name] of registry.getCronJobs()) registry.deleteCronJob(name);
  return app;
}

/**
 * The same app with a different environment — and, where one is given, a fake
 * Active Directory in place of the real one (ADR-0018).
 *
 * The fake goes in at the `Directory` port, not inside `ldapts`, so what the
 * test exercises is everything the API does with an answer from the
 * directory: the group→role mapping, the app_user upsert, the claims and the
 * token. What it does not exercise is the LDAP conversation itself — see
 * ADR-0018 on why, and on what has to be checked by hand at deployment.
 */
export async function createAppWith(
  env: Record<string, string>,
  directory?: Directory,
): Promise<INestApplication> {
  const config = loadConfig({ ...process.env, ...env });
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONFIG)
    .useValue(config);
  if (directory) builder = builder.overrideProvider(DIRECTORY).useValue(directory);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return withoutTimers(app);
}

/**
 * A token for a seeded user, minted the same way the dev-token route mints
 * one — which is the same claims shape Entra ID sends in production
 * (ADR-0009), so the tests exercise the real guard and not a mock of it.
 */
export async function tokenFor(app: INestApplication, email: string): Promise<string> {
  const config = app.get<AppConfig>(CONFIG);
  const { AuthService } = await import("../src/auth/auth.service");
  const auth = app.get(AuthService);
  const { token } = await auth.devTokenFor(email);
  // Touching the config keeps the secret in one place and fails loudly if a
  // test ever runs with the stub off.
  if (config.authMode !== "dev") throw new Error("AUTH_MODE must be dev in tests");
  return token;
}

/** A syntactically valid token signed with the wrong secret. */
export async function forgedToken(): Promise<string> {
  return signSessionToken(
    TokenClaims.parse({
      sub: "not-a-user",
      name: "Someone Else",
      email: "someone@example.test",
      roles: ["admin"],
      org_unit_ids: ["nicosia-general"],
    }),
    "a-different-secret-entirely-0123456789",
  );
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Every row of a paged list, walked page by page — for a list other suites
 * add to (projects, permits, assets).
 *
 * The suites share one database (ADR-0012), so a single page of such a list
 * holds whatever the files that ran before put on it: with enough of their
 * rows the seeded ones sort onto page two, and a test that read one page of
 * 200 saw 39 of the 41 seeded projects. Read the whole list and pick out the
 * rows the test is about — its own, or seeded ones by a stable key.
 */
export async function listAll<T extends { id: string }>(
  app: INestApplication,
  token: string,
  path: string,
  pageSize = 100,
): Promise<{ items: T[]; total: number }> {
  const items: T[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await request(app.getHttpServer())
      .get(`${path}${separator}page=${page}&pageSize=${pageSize}`)
      .set(bearer(token));
    if (response.status !== 200) {
      throw new Error(`${path} page ${page}: ${response.status} ${JSON.stringify(response.body)}`);
    }
    const body = response.body as { items: T[]; total: number };
    total = body.total;
    for (const item of body.items) {
      // A row met twice means the order is not stable across pages, and the
      // walk could have skipped another: fail rather than undercount.
      if (seen.has(item.id)) throw new Error(`${path}: ${item.id} on two pages`);
      seen.add(item.id);
      items.push(item);
    }
    if (body.items.length < pageSize || items.length >= total) break;
  }
  if (items.length !== total) throw new Error(`${path}: walked ${items.length} rows of ${total}`);
  return { items, total };
}

/** Every project the caller may see that matches `query` (no `page`/`pageSize` in it). */
export async function allProjects(
  app: INestApplication,
  email: string,
  query = "",
): Promise<{ items: ProjectSummary[]; total: number }> {
  const token = await tokenFor(app, email);
  const { items, total } = await listAll<ProjectSummary>(app, token, `/projects${query}`, 200);
  return { items: items.map((item) => ProjectSummary.parse(item)), total };
}
