import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { CONFIG, loadConfig, type AppConfig } from "../src/config";
import { DIRECTORY, type Directory } from "../src/auth/directory";
import { DEV_AUDIENCE, DEV_ISSUER, signSessionToken } from "../src/auth/tokens";
import { TokenClaims } from "@ecapital/shared";

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
  return app;
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
