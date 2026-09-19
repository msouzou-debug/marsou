import type { INestApplication } from "@nestjs/common";
import { AdminUser, TokenClaims } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Directory, DirectoryUser } from "../src/auth/directory";
import { signSessionToken } from "../src/auth/tokens";
import { bearer, createAppWith } from "./app";

/**
 * ADR-0020 — what happens where the two halves meet: an account an
 * administrator pre-registered, and the Active Directory bind that arrives
 * afterwards.
 *
 * The two things this file is for:
 *
 *   1. **Adoption.** A pre-registered row has no objectGUID to key on, so it
 *      carries `ad:<username>`. The first bind must find it by account name
 *      and move the subject onto the GUID, or the roles the administrator
 *      set would be stranded on a row nobody signs in as.
 *   2. **The merge.** Roles on the token are what the administrator assigned
 *      unioned with what `role_mapping` makes of the directory groups, and a
 *      sign-in never deletes the assignment.
 */

const DOMAIN = "ihcis.local";
const TECH_GROUP = "CN=eCapital Technicians,OU=Groups,DC=ihcis,DC=local";

const LDAP_ENV = {
  AUTH_MODE: "ldap",
  LDAP_URL: "ldap://dc01.ihcis.local:389",
  LDAP_BASE_DN: "DC=ihcis,DC=local",
  LDAP_DOMAIN: DOMAIN,
};

const GUID = "a1b2c3d4-0000-4c1d-8d27-4b1f2a3c9999";
const USERNAME = "n.test";

class FakeDirectory implements Directory {
  constructor(private readonly user: DirectoryUser, private readonly password: string) {}
  authenticate(username: string, password: string): Promise<DirectoryUser | null> {
    if (username.split("@")[0].toLowerCase() !== USERNAME || password !== this.password) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.user);
  }
}

describe("pre-registration and the first Active Directory sign-in", () => {
  let app: INestApplication;
  let db: Client;
  let adminToken: string;
  let userId: string;

  beforeAll(async () => {
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await db.connect();
    await db.query("delete from ecapital.app_user where lower(username) = $1 or subject = $2", [
      USERNAME,
      GUID,
    ]);

    app = await createAppWith(
      LDAP_ENV,
      new FakeDirectory(
        {
          objectGuid: GUID,
          // Active Directory spells it back in whatever case the console
          // holds; the match has to be case-insensitive.
          uid: "N.Test",
          displayName: "Νίκη Τεστ",
          mail: "n.test@shso.org.cy",
          memberOf: [TECH_GROUP],
        },
        "correct horse",
      ),
    );

    // `/auth/dev-token` answers 404 in ldap mode, so the administrator's
    // token is signed here the way the API signs one — the guard cannot tell
    // the difference and is not meant to (ADR-0018).
    const units = await db.query<{ id: string }>("select id from ecapital.org_unit");
    adminToken = await signSessionToken(
      TokenClaims.parse({
        sub: "dev-admin",
        name: "Μαρία Κωνσταντίνου",
        email: "admin@ecapital.test",
        roles: ["admin"],
        org_unit_ids: units.rows.map((u) => u.id),
      }),
      process.env.DEV_AUTH_SECRET as string,
    );
  });

  afterAll(async () => {
    await app.close();
    await db.query("delete from ecapital.role_mapping where note = 'adr-0020 test'");
    await db.query("delete from ecapital.app_user where lower(username) = $1 or subject = $2", [
      USERNAME,
      GUID,
    ]);
    await db.end();
  });

  it("pre-registers the account with `ad:<username>` for a subject", async () => {
    const response = await request(app.getHttpServer())
      .post("/admin/users")
      .set(bearer(adminToken))
      .send({
        username: USERNAME,
        name: "Νίκη Τεστ",
        roles: ["project_engineer"],
        orgUnitIds: ["larnaca-general"],
      });
    expect(response.status).toBe(201);
    const user = AdminUser.parse(response.body);
    userId = user.id;
    expect(user.subject).toBe(`ad:${USERNAME}`);
    expect(user.lastSignInAt).toBeNull();
  });

  it("adopts the objectGUID on the first bind, and the roles survive it", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: USERNAME, password: "correct horse" });

    expect(login.status).toBe(201);
    expect(login.body.claims.sub).toBe(GUID);
    // The roles an administrator set before the person ever signed in.
    expect(login.body.claims.roles).toEqual(["project_engineer"]);
    expect(login.body.claims.orgUnitIds).toEqual(["larnaca-general"]);
    // And it is the same row, not a second one.
    expect(login.body.claims.userId).toBe(userId);

    const { rows } = await db.query<{ subject: string; auth_source: string; last_sign_in_at: Date | null }>(
      "select subject, auth_source, last_sign_in_at from ecapital.app_user where lower(username) = $1",
      [USERNAME],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe(GUID);
    expect(rows[0].auth_source).toBe("ldap");
    expect(rows[0].last_sign_in_at).not.toBeNull();
  });

  it("unions the assigned roles with the group-mapped ones, in both directions", async () => {
    await db.query(
      `insert into ecapital.role_mapping (group_id, role, org_unit_id, note)
            values ($1, 'technician', 'nicosia-general', 'adr-0020 test')
       on conflict do nothing`,
      [TECH_GROUP],
    );

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: USERNAME, password: "correct horse" });
    expect(login.status).toBe(201);
    expect(login.body.claims.roles).toEqual(["project_engineer", "technician"]);
    expect(login.body.claims.orgUnitIds).toEqual(["larnaca-general", "nicosia-general"]);

    // RULE (ADR-0020): the sign-in did not write the mapped role into
    // `app_user_role` and did not delete the assigned one. The optional
    // group layer stays a layer.
    const assigned = await db.query<{ role: string }>(
      "select role from ecapital.app_user_role where app_user_id = $1 order by role",
      [userId],
    );
    expect(assigned.rows.map((r) => r.role)).toEqual(["project_engineer"]);

    // The other direction: the administrator takes the assigned role away and
    // only the mapped one is left.
    const stripped = await request(app.getHttpServer())
      .patch(`/admin/users/${userId}`)
      .set(bearer(adminToken))
      .send({ roles: [], orgUnitIds: [] });
    expect(stripped.status).toBe(200);

    const again = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: USERNAME, password: "correct horse" });
    expect(again.body.claims.roles).toEqual(["technician"]);
    expect(again.body.claims.orgUnitIds).toEqual(["nicosia-general"]);
  });

  it("refuses a deactivated account, with the password already proved right", async () => {
    const off = await request(app.getHttpServer())
      .patch(`/admin/users/${userId}`)
      .set(bearer(adminToken))
      .send({ active: false });
    expect(off.status).toBe(200);

    const refused = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: USERNAME, password: "correct horse" });
    expect(refused.status).toBe(401);
    expect(refused.body.key).toBe("errors.accountDeactivated");

    // And signing in did not quietly switch the account back on.
    const { rows } = await db.query<{ is_active: boolean }>(
      "select is_active from ecapital.app_user where id = $1",
      [userId],
    );
    expect(rows[0].is_active).toBe(false);
  });
});
