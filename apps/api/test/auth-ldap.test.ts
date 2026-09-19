import type { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Directory, DirectoryUser } from "../src/auth/directory";
import { bearer, createAppWith } from "./app";

/**
 * ADR-0018 — signing in with a ΟΚΥπΥ Active Directory account.
 *
 * The fake below stands in for the directory at the `Directory` port, which
 * is the seam the API owns. That is an honest boundary and a deliberately
 * limited one: everything the API does with a directory answer is exercised
 * for real — the group→role mapping, the app_user upsert, the claims, the
 * token, the guard that verifies it and the row policies underneath — and
 * the LDAP conversation itself is not. Running a second LDAP server
 * in-process (ldapts can talk to ldapjs's) would test ldapts against ldapjs
 * and prove nothing about Active Directory, which is what the ΟΚΥπΥ estate
 * actually runs. ADR-0018 says what has to be checked by hand instead.
 */

const DOMAIN = "ihcis.local";
const ADMIN_GROUP = "CN=eCapital Admins,OU=Groups,DC=ihcis,DC=local";
const ENGINEER_GROUP = "CN=eCapital Engineers Larnaca,OU=Groups,DC=ihcis,DC=local";
const UNKNOWN_GROUP = "CN=Printer Users,OU=Groups,DC=ihcis,DC=local";

const LDAP_ENV = {
  AUTH_MODE: "ldap",
  LDAP_URL: "ldap://dc01.ihcis.local:389",
  LDAP_BASE_DN: "DC=ihcis,DC=local",
  LDAP_DOMAIN: DOMAIN,
};

/** A directory with two accounts and one wrong password between them. */
class FakeDirectory implements Directory {
  readonly seen: string[] = [];

  constructor(private readonly accounts: Record<string, { password: string; user: DirectoryUser }>) {}

  authenticate(username: string, password: string): Promise<DirectoryUser | null> {
    this.seen.push(username);
    const uid = username.split("@")[0].toLowerCase();
    const account = this.accounts[uid];
    if (!account || account.password !== password) return Promise.resolve(null);
    return Promise.resolve(account.user);
  }
}

function directory(): FakeDirectory {
  return new FakeDirectory({
    apapadopoulos: {
      password: "correct horse",
      user: {
        objectGuid: "fe352b0e-2a9c-4c1d-8d27-4b1f2a3c4d5e",
        uid: "APapadopoulos",
        displayName: "Ανδρέας Παπαδόπουλος",
        mail: "a.papadopoulos@shso.org.cy",
        memberOf: [ENGINEER_GROUP, UNKNOWN_GROUP],
      },
    },
    kstylianou: {
      password: "another one",
      user: {
        objectGuid: null,
        uid: "KStylianou",
        displayName: null,
        mail: null,
        // Nothing eCapital knows about: a person with a directory account and
        // no eCapital role yet.
        memberOf: [UNKNOWN_GROUP],
      },
    },
  });
}

describe("AUTH_MODE=ldap", () => {
  let app: INestApplication;
  let fake: FakeDirectory;
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
    // The rows an administrator writes at deployment. FLAG (ADR-0018): which
    // real ΟΚΥπΥ group maps to which role is their decision, not ours.
    await admin.query(
      `insert into ecapital.role_mapping (group_id, role, org_unit_id, note)
            values ($1, 'admin', null, 'test'),
                   ($2, 'project_engineer', 'larnaca-general', 'test')
       on conflict do nothing`,
      [ADMIN_GROUP, ENGINEER_GROUP],
    );
    fake = directory();
    app = await createAppWith(LDAP_ENV, fake);
  });

  afterAll(async () => {
    await app.close();
    await admin.query("delete from ecapital.role_mapping where note = 'test'");
    await admin.query("delete from ecapital.app_user_role where app_user_id in (select id from ecapital.app_user where auth_source = 'ldap')");
    await admin.query("delete from ecapital.app_user_org_unit where app_user_id in (select id from ecapital.app_user where auth_source = 'ldap')");
    await admin.query("delete from ecapital.app_user where auth_source = 'ldap'");
    await admin.end();
  });

  it("binds with the UPN, maps the group to a role and a unit, and issues a token", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "apapadopoulos", password: "correct horse" });

    expect(response.status).toBe(201);
    expect(response.body.claims).toMatchObject({
      sub: "fe352b0e-2a9c-4c1d-8d27-4b1f2a3c4d5e",
      name: "Ανδρέας Παπαδόπουλος",
      email: "a.papadopoulos@shso.org.cy",
      roles: ["project_engineer"],
      orgUnitIds: ["larnaca-general"],
    });
    // The bare name the user typed reached the directory as a UPN.
    expect(fake.seen).toContain("apapadopoulos");

    // And the token it handed back is a token the guard accepts.
    const me = await request(app.getHttpServer()).get("/me").set(bearer(response.body.token));
    expect(me.status).toBe(200);
    expect(me.body.roles).toEqual(["project_engineer"]);
    expect(me.body.orgUnitIds).toEqual(["larnaca-general"]);
  });

  it("writes the app_user row and marks where it came from", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "apapadopoulos", password: "correct horse" });
    const { rows } = await admin.query<{ auth_source: string; email: string }>(
      "select auth_source, email from ecapital.app_user where subject = $1",
      ["fe352b0e-2a9c-4c1d-8d27-4b1f2a3c4d5e"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].auth_source).toBe("ldap");
    expect(rows[0].email).toBe("a.papadopoulos@shso.org.cy");
  });

  it("answers 401 and nothing more when the bind fails", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "apapadopoulos", password: "not the password" });
    expect(response.status).toBe(401);
    expect(response.body.key).toBe("errors.notSignedIn");
    // RULE (ADR-0018): the answer must not say which half of the guess was
    // right, and must never carry the password back.
    expect(JSON.stringify(response.body)).not.toContain("not the password");
  });

  it("gives the same 401 for an account the directory has never heard of", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "nobody", password: "anything" });
    expect(response.status).toBe(401);
    expect(response.body.key).toBe("errors.notSignedIn");
  });

  it("lets an unmapped account in with no roles and no units", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "kstylianou", password: "another one" });
    expect(response.status).toBe(201);
    expect(response.body.claims.roles).toEqual([]);
    expect(response.body.claims.orgUnitIds).toEqual([]);
    // ADR-0009's safe direction: they are signed in and they see nothing.
    expect(response.body.claims.sub).toBe("ad:kstylianou");

    const projects = await request(app.getHttpServer())
      .get("/projects")
      .set(bearer(response.body.token));
    expect(projects.status).toBe(200);
    expect(projects.body.items).toEqual([]);
  });

  it("falls back to the UPN when the directory holds no mail attribute", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "kstylianou", password: "another one" });
    expect(response.body.claims.email).toBe(`kstylianou@${DOMAIN}`);
  });

  it("refuses a body with no password", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "apapadopoulos" });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.credentialsNeeded");
  });

  it("answers 404 to /auth/dev-token — in ldap mode the stub does not exist", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/dev-token")
      .send({ email: "admin@ecapital.test" });
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.routeNotFound");
  });
});

describe("AUTH_MODE=dev", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createAppWith({ AUTH_MODE: "dev" });
  });
  afterAll(async () => {
    await app.close();
  });

  it("answers 404 to /auth/login — in dev mode there is no directory to bind to", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "apapadopoulos", password: "correct horse" });
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.routeNotFound");
  });
});
