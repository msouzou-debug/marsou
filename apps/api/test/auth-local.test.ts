import type { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DIRECTORY } from "../src/auth/directory";
import { LocalDirectory } from "../src/auth/local.directory";
import { setPassword } from "../src/cli/set-password";
import { USERS, bearer, createAppWith, tokenFor } from "./app";

/**
 * ADR-0030 — `AUTH_MODE=local`: a username and a password eCapital holds
 * itself, for the weeks the ΟΚΥπΥ directory is not reachable.
 *
 * Two apps share the one test database: a `dev` one, which is where the
 * administrator's token comes from (the stub is the only way to mint one
 * without a password), and the `local` one under test. Both sign the
 * session token with the same secret, so a token from the first is a token
 * the second accepts — which is also how the modes behave on the server
 * when one is swapped for the other.
 */

const USERNAME = "m.local";
const SEEDED = "technician.nicosia@ecapital.test";
const PASSWORD = "correct horse battery";

describe("AUTH_MODE=local (ADR-0030)", () => {
  let devApp: INestApplication;
  let app: INestApplication;
  let db: Client;
  let adminToken: string;
  let userId: string;

  beforeAll(async () => {
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await db.connect();
    await db.query("delete from ecapital.app_user where lower(username) = $1", [USERNAME]);
    devApp = await createAppWith({ AUTH_MODE: "dev" });
    adminToken = await tokenFor(devApp, USERS.admin);
    app = await createAppWith({ AUTH_MODE: "local" });
  });

  afterAll(async () => {
    await db.query("delete from ecapital.app_user where lower(username) = $1", [USERNAME]);
    // The seeded technician signed in through the local path once; put the
    // row back the way the seed wrote it so no other file sees the change.
    await db.query(
      `delete from ecapital.app_user_password
        where app_user_id = (select id from ecapital.app_user where email = $1)`,
      [SEEDED],
    );
    await db.query(
      "update ecapital.app_user set username = null, auth_source = 'dev' where email = $1",
      [SEEDED],
    );
    await db.end();
    await app.close();
    await devApp.close();
  });

  it("pre-registers an account the way the screen does, as a local one with no password yet", async () => {
    const response = await request(app.getHttpServer())
      .post("/admin/users")
      .set(bearer(adminToken))
      .send({ username: USERNAME, name: "Μαρία Τοπική", roles: ["project_engineer"], orgUnitIds: ["larnaca-general"] });
    expect(response.status).toBe(201);
    expect(response.body.subject).toBe(`ad:${USERNAME}`);
    expect(response.body.authSource).toBe("local");
    expect(response.body.hasPassword).toBe(false);
    userId = response.body.id;
  });

  it("refuses a password under eight characters", async () => {
    const response = await request(app.getHttpServer())
      .put(`/admin/users/${userId}/password`)
      .set(bearer(adminToken))
      .send({ password: "short" });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.passwordNotValid");
  });

  it("refuses to set a password for anybody but an administrator", async () => {
    const engineer = await tokenFor(devApp, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .put(`/admin/users/${userId}/password`)
      .set(bearer(engineer))
      .send({ password: PASSWORD });
    expect(response.status).toBe(403);
  });

  it("sets the password, records the fact and never the hash", async () => {
    const response = await request(app.getHttpServer())
      .put(`/admin/users/${userId}/password`)
      .set(bearer(adminToken))
      .send({ password: PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.hasPassword).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(response.body)).not.toContain("scrypt");

    const { rows } = await db.query<{ action: string; after: Record<string, unknown>; actor_id: string }>(
      `select action, after, actor_id from ecapital.audit_log
        where entity_type = 'app_user_password' and entity_id = $1
        order by at desc limit 1`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("INSERT");
    expect(Object.keys(rows[0].after).sort()).toEqual(["id", "updated_at"]);
    expect(rows[0].actor_id).toBe("dev-admin");
  });

  it("signs in with the username and the password, on the roles the administrator assigned", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "M.Local", password: PASSWORD });
    expect(response.status).toBe(201);
    expect(response.body.claims).toMatchObject({
      sub: `ad:${USERNAME}`,
      name: "Μαρία Τοπική",
      roles: ["project_engineer"],
      orgUnitIds: ["larnaca-general"],
    });
    const me = await request(app.getHttpServer()).get("/me").set(bearer(response.body.token));
    expect(me.status).toBe(200);
    expect(me.body.roles).toEqual(["project_engineer"]);

    const { rows } = await db.query<{ auth_source: string; subject: string; last_sign_in_at: Date | null }>(
      "select auth_source, subject, last_sign_in_at from ecapital.app_user where id = $1",
      [userId],
    );
    // The subject stays `ad:<username>`, so the first Active Directory bind
    // adopts this row by username exactly like a pre-registered one (ADR-0020).
    expect(rows[0].subject).toBe(`ad:${USERNAME}`);
    expect(rows[0].auth_source).toBe("local");
    expect(rows[0].last_sign_in_at).not.toBeNull();
  });

  it("answers the same 401 to a wrong password and to an unknown name", async () => {
    const wrong = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: USERNAME, password: "not the password" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.key).toBe("errors.notSignedIn");
    expect(JSON.stringify(wrong.body)).not.toContain("not the password");

    const unknown = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "nobody.here", password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.key).toBe("errors.notSignedIn");
    app.get<LocalDirectory>(DIRECTORY).reset();
  });

  it("lets a seeded account sign in by its address once it has a password, keeping its subject", async () => {
    const list = await request(app.getHttpServer())
      .get(`/admin/users?q=${encodeURIComponent(SEEDED)}`)
      .set(bearer(adminToken));
    const technician = list.body.items.find((u: { email: string }) => u.email === SEEDED);
    expect(technician).toBeDefined();

    const set = await request(app.getHttpServer())
      .put(`/admin/users/${technician.id}/password`)
      .set(bearer(adminToken))
      .send({ password: PASSWORD });
    expect(set.status).toBe(200);

    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: SEEDED, password: PASSWORD });
    expect(response.status).toBe(201);
    expect(response.body.claims.sub).toBe(technician.subject);
    expect(response.body.claims.roles).toEqual(["technician"]);
  });

  it("refuses a deactivated account with the password proved", async () => {
    const off = await request(app.getHttpServer())
      .patch(`/admin/users/${userId}`)
      .set(bearer(adminToken))
      .send({ active: false });
    expect(off.status).toBe(200);
    const response = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: USERNAME, password: PASSWORD });
    expect(response.status).toBe(401);
    expect(response.body.key).toBe("errors.accountDeactivated");
    await request(app.getHttpServer())
      .patch(`/admin/users/${userId}`)
      .set(bearer(adminToken))
      .send({ active: true });
    app.get<LocalDirectory>(DIRECTORY).reset();
  });

  it("locks the name after five wrong passwords, right one included", async () => {
    for (let i = 0; i < LocalDirectory.MAX_FAILURES; i += 1) {
      const attempt = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ username: USERNAME, password: `guess ${i}` });
      expect(attempt.status).toBe(401);
    }
    const locked = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: USERNAME, password: PASSWORD });
    expect(locked.status).toBe(401);

    app.get<LocalDirectory>(DIRECTORY).reset(USERNAME);
    const again = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: USERNAME, password: PASSWORD });
    expect(again.status).toBe(201);
  });

  it("takes a password from the server CLI as well, under the cli actor", async () => {
    await expect(
      setPassword({
        connectionString: process.env.MIGRATION_DATABASE_URL as string,
        username: USERNAME,
        password: "short",
        actor: "cli:test",
      }),
    ).rejects.toThrow(/at least 8/);
    await expect(
      setPassword({
        connectionString: process.env.MIGRATION_DATABASE_URL as string,
        username: "nobody.here",
        password: "another password",
        actor: "cli:test",
      }),
    ).rejects.toThrow(/no account is called/);

    const done = await setPassword({
      connectionString: process.env.MIGRATION_DATABASE_URL as string,
      username: USERNAME,
      password: "another password",
      actor: "cli:test",
    });
    expect(done.userId).toBe(userId);

    const old = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: USERNAME, password: PASSWORD });
    expect(old.status).toBe(401);
    app.get<LocalDirectory>(DIRECTORY).reset(USERNAME);
    const fresh = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ username: USERNAME, password: "another password" });
    expect(fresh.status).toBe(201);

    const { rows } = await db.query<{ actor_id: string; action: string }>(
      `select actor_id, action from ecapital.audit_log
        where entity_type = 'app_user_password' and entity_id = $1
        order by at desc limit 1`,
      [userId],
    );
    expect(rows[0]).toEqual({ actor_id: "cli:test", action: "UPDATE" });
  });

  it("answers 404 to the dev-token stub: in local mode it does not exist", async () => {
    const response = await request(app.getHttpServer())
      .post("/auth/dev-token")
      .send({ email: USERS.admin });
    expect(response.status).toBe(404);
  });

  it("has no password route outside local mode", async () => {
    const response = await request(devApp.getHttpServer())
      .put(`/admin/users/${userId}/password`)
      .set(bearer(adminToken))
      .send({ password: PASSWORD });
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.routeNotFound");
  });
});
