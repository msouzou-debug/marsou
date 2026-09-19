import type { INestApplication } from "@nestjs/common";
import { AdminUser, AdminUserList, RoleCatalogue } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * ADR-0020 — roles are assigned per user by an administrator, not by an AD
 * group. R01 (who may see what), R02 (the eight personas), R42 (audited).
 *
 * Every rule in the ADR is a test here, and the four that can be broken by
 * accident — locking yourself out, taking the last administrator away,
 * touching the auditor, and a unit role with no unit — are 422s with a
 * sentence, which is what the screen shows inline.
 */
describe("/admin/users", () => {
  let app: INestApplication;
  let admin: Client;
  const created: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
  });

  afterAll(async () => {
    for (const id of created) {
      await admin.query("delete from ecapital.app_user where id = $1", [id]);
    }
    await app.close();
    await admin.end();
  });

  async function post(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer()).post("/admin/users").set(bearer(token)).send(body);
  }

  async function makeUser(
    token: string,
    body: Record<string, unknown>,
  ): Promise<AdminUser> {
    const response = await post(token, body);
    expect(response.status).toBe(201);
    const user = AdminUser.parse(response.body);
    created.push(user.id);
    return user;
  }

  const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  it("lists the seeded accounts with their roles, units and last sign-in", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get("/admin/users")
      .query({ pageSize: 200 })
      .set(bearer(token));

    expect(response.status).toBe(200);
    const list = AdminUserList.parse(response.body);
    expect(list.total).toBeGreaterThanOrEqual(8);

    const seededAdmin = list.items.find((u) => u.email === USERS.admin);
    expect(seededAdmin).toBeDefined();
    expect(seededAdmin?.roles).toContain("admin");
    expect(seededAdmin?.active).toBe(true);
    // `tokenFor` above is a sign-in, so the stamp is there.
    expect(seededAdmin?.lastSignInAt).not.toBeNull();
    // The M0 seed wrote no username; the address stands in for one.
    expect(seededAdmin?.username).toBe(USERS.admin);

    const engineer = list.items.find((u) => u.email === USERS.engineerLarnaca);
    expect(engineer?.roles).toEqual(["project_engineer"]);
    expect(engineer?.orgUnitIds).toEqual(["larnaca-general"]);
  });

  it("filters by search term, by role, by unit and by whether the account is on", async () => {
    const token = await tokenFor(app, USERS.admin);
    const get = async (query: Record<string, unknown>) => {
      const response = await request(app.getHttpServer())
        .get("/admin/users")
        .query({ pageSize: 200, ...query })
        .set(bearer(token));
      expect(response.status).toBe(200);
      return AdminUserList.parse(response.body);
    };

    const byRole = await get({ role: "technician" });
    expect(byRole.items.every((u) => u.roles.includes("technician"))).toBe(true);
    expect(byRole.items.some((u) => u.email === USERS.technicianNicosia)).toBe(true);

    const byUnit = await get({ unit: "larnaca-general" });
    expect(byUnit.items.some((u) => u.email === USERS.engineerLarnaca)).toBe(true);

    const bySearch = await get({ q: "engineer.larnaca" });
    expect(bySearch.items.map((u) => u.email)).toEqual([USERS.engineerLarnaca]);

    const off = await get({ active: "false" });
    expect(off.items.every((u) => !u.active)).toBe(true);
  });

  it("answers the eight roles with their scope, so the screen hardcodes none", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/admin/roles").set(bearer(token));
    expect(response.status).toBe(200);
    const catalogue = RoleCatalogue.parse(response.body);
    expect(catalogue).toHaveLength(8);
    expect(catalogue.find((r) => r.role === "admin")?.scope).toBe("all");
    expect(catalogue.find((r) => r.role === "finance")?.scope).toBe("all");
    expect(catalogue.find((r) => r.role === "project_engineer")?.scope).toBe("unit");
  });

  it("pre-registers an account that has never signed in", async () => {
    const token = await tokenFor(app, USERS.admin);
    const username = `n.test.${unique()}`;
    const user = await makeUser(token, {
      username,
      name: "Νίκη Τεστ",
      roles: ["project_engineer"],
      orgUnitIds: ["larnaca-general"],
    });

    expect(user.username).toBe(username);
    expect(user.roles).toEqual(["project_engineer"]);
    expect(user.orgUnitIds).toEqual(["larnaca-general"]);
    expect(user.lastSignInAt).toBeNull();
    expect(user.active).toBe(true);

    const again = await post(token, { username, roles: [], orgUnitIds: [] });
    expect(again.status).toBe(422);
    expect(again.body.key).toBe("errors.usernameTaken");
  });

  it("RULE (a): an administrator cannot take their own role away or switch themselves off", async () => {
    const token = await tokenFor(app, USERS.admin);
    const me = await request(app.getHttpServer()).get("/me").set(bearer(token));
    const id = me.body.userId as string;

    const dropped = await request(app.getHttpServer())
      .patch(`/admin/users/${id}`)
      .set(bearer(token))
      .send({ roles: ["finance"] });
    expect(dropped.status).toBe(422);
    expect(dropped.body.key).toBe("errors.selfLockout");

    const off = await request(app.getHttpServer())
      .patch(`/admin/users/${id}`)
      .set(bearer(token))
      .send({ active: false });
    expect(off.status).toBe(422);
    expect(off.body.key).toBe("errors.selfLockout");

    // And the account is untouched by either attempt.
    const after = await request(app.getHttpServer()).get(`/admin/users/${id}`).set(bearer(token));
    expect(AdminUser.parse(after.body).roles).toContain("admin");
  });

  it("RULE (b): the last active administrator keeps the role", async () => {
    // The token outlives a role change — it carries `admin` for eight hours
    // whatever the database says afterwards — so this is the shape the rule
    // is actually for: somebody who is no longer an administrator taking the
    // last remaining one away.
    const token = await tokenFor(app, USERS.admin);
    const me = await request(app.getHttpServer()).get("/me").set(bearer(token));
    const seededAdminId = me.body.userId as string;

    const other = await makeUser(token, {
      username: `bootstrap.${unique()}`,
      name: "Δεύτερος διαχειριστής",
      roles: ["admin"],
      orgUnitIds: [],
    });

    await admin.query("delete from ecapital.app_user_role where app_user_id = $1 and role = 'admin'", [
      seededAdminId,
    ]);
    try {
      const refused = await request(app.getHttpServer())
        .patch(`/admin/users/${other.id}`)
        .set(bearer(token))
        .send({ roles: ["finance"] });
      expect(refused.status).toBe(422);
      expect(refused.body.key).toBe("errors.lastAdmin");
    } finally {
      await admin.query(
        "insert into ecapital.app_user_role (app_user_id, role) values ($1, 'admin') on conflict do nothing",
        [seededAdminId],
      );
    }

    // With the seeded administrator back, the same change goes through.
    const allowed = await request(app.getHttpServer())
      .patch(`/admin/users/${other.id}`)
      .set(bearer(token))
      .send({ roles: ["finance"] });
    expect(allowed.status).toBe(200);
    expect(AdminUser.parse(allowed.body).roles).toEqual(["finance"]);
  });

  it("RULE (c): the auditor is not an administrator's to grant or to take away", async () => {
    const token = await tokenFor(app, USERS.admin);
    const user = await makeUser(token, {
      username: `auditor.wannabe.${unique()}`,
      roles: ["technician"],
      orgUnitIds: ["nicosia-general"],
    });

    const granted = await request(app.getHttpServer())
      .patch(`/admin/users/${user.id}`)
      .set(bearer(token))
      .send({ roles: ["auditor_readonly"] });
    expect(granted.status).toBe(422);
    expect(granted.body.key).toBe("errors.auditorProtected");

    const atCreation = await post(token, {
      username: `auditor.wannabe2.${unique()}`,
      roles: ["auditor_readonly"],
      orgUnitIds: [],
    });
    expect(atCreation.status).toBe(422);
    expect(atCreation.body.key).toBe("errors.auditorProtected");

    // And the seeded auditor cannot be stripped of it either.
    const list = await request(app.getHttpServer())
      .get("/admin/users")
      .query({ q: "auditor@", pageSize: 200 })
      .set(bearer(token));
    const auditor = AdminUserList.parse(list.body).items.find((u) => u.email === USERS.auditor);
    expect(auditor).toBeDefined();

    const stripped = await request(app.getHttpServer())
      .patch(`/admin/users/${auditor?.id}`)
      .set(bearer(token))
      .send({ roles: [] });
    expect(stripped.status).toBe(422);
    expect(stripped.body.key).toBe("errors.auditorProtected");

    // A change that leaves the role alone is still allowed.
    const renamed = await request(app.getHttpServer())
      .patch(`/admin/users/${auditor?.id}`)
      .set(bearer(token))
      .send({ name: auditor?.name });
    expect(renamed.status).toBe(200);
  });

  it("RULE (d): a unit role needs a unit, and an all-units role ignores the list", async () => {
    const token = await tokenFor(app, USERS.admin);
    const user = await makeUser(token, {
      username: `units.${unique()}`,
      roles: ["technician"],
      orgUnitIds: ["nicosia-general"],
    });

    const withoutUnit = await request(app.getHttpServer())
      .patch(`/admin/users/${user.id}`)
      .set(bearer(token))
      .send({ roles: ["project_engineer"], orgUnitIds: [] });
    expect(withoutUnit.status).toBe(422);
    expect(withoutUnit.body.key).toBe("errors.unitRequired");

    const atCreation = await post(token, {
      username: `units2.${unique()}`,
      roles: ["estates_head"],
      orgUnitIds: [],
    });
    expect(atCreation.status).toBe(422);
    expect(atCreation.body.key).toBe("errors.unitRequired");

    // `finance` reaches every unit, so the one unit the caller sent is
    // replaced by all of them — which for finance is what grants the access
    // at all, since the row policies do not let it through on the role.
    const { rows } = await admin.query<{ total: number }>(
      "select count(*)::int as total from ecapital.org_unit",
    );
    const financed = await request(app.getHttpServer())
      .patch(`/admin/users/${user.id}`)
      .set(bearer(token))
      .send({ roles: ["finance"], orgUnitIds: ["nicosia-general"] });
    expect(financed.status).toBe(200);
    expect(AdminUser.parse(financed.body).orgUnitIds).toHaveLength(rows[0].total);
  });

  it("RULE (e): every change leaves an audit row with the before and the after", async () => {
    const token = await tokenFor(app, USERS.admin);
    const user = await makeUser(token, {
      username: `audited.${unique()}`,
      name: "Πριν",
      roles: ["technician"],
      orgUnitIds: ["nicosia-general"],
    });

    const patched = await request(app.getHttpServer())
      .patch(`/admin/users/${user.id}`)
      .set(bearer(token))
      .send({ name: "Μετά", roles: ["project_engineer"], orgUnitIds: ["larnaca-general"] });
    expect(patched.status).toBe(200);

    const log = await request(app.getHttpServer())
      .get("/audit-log")
      .query({ entity_type: "app_user", entity_id: user.id })
      .set(bearer(token));
    expect(log.status).toBe(200);
    const nameChange = (log.body as { action: string; before: { name?: string } | null; after: { name?: string } | null }[])
      .find((row) => row.action === "UPDATE" && row.after?.name === "Μετά");
    expect(nameChange?.before?.name).toBe("Πριν");
    expect(nameChange).toBeDefined();

    // The role rows are audited too; `app_user_role` has no id column, so
    // the entry is found by the user it belongs to.
    const roleRows = await admin.query<{ action: string; after: { role?: string } | null }>(
      `select action::text as action, after
         from ecapital.audit_log
        where entity_type = 'app_user_role'
          and coalesce(after ->> 'app_user_id', before ->> 'app_user_id') = $1
        order by id`,
      [user.id],
    );
    expect(roleRows.rows.some((r) => r.action === "INSERT" && r.after?.role === "project_engineer")).toBe(true);
    expect(roleRows.rows.some((r) => r.action === "DELETE")).toBe(true);
  });

  it("refuses a deactivated account at the door and takes its cookie away", async () => {
    const token = await tokenFor(app, USERS.admin);
    const username = `switched.off.${unique()}`;
    const user = await makeUser(token, {
      username,
      roles: ["technician"],
      orgUnitIds: ["nicosia-general"],
    });

    // The stub signs people in by address, and a pre-registered dev account
    // gets one derived from the account name.
    const before = await request(app.getHttpServer())
      .post("/auth/dev-token")
      .send({ email: user.email });
    expect(before.status).toBe(201);

    const off = await request(app.getHttpServer())
      .patch(`/admin/users/${user.id}`)
      .set(bearer(token))
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(AdminUser.parse(off.body).active).toBe(false);

    const refused = await request(app.getHttpServer())
      .post("/auth/dev-token")
      .send({ email: user.email });
    expect(refused.status).toBe(401);
    expect(refused.body.key).toBe("errors.accountDeactivated");

    // The token they were already holding stops working at /me, which is
    // where the web app notices and clears the cookie (ADR-0013).
    const me = await request(app.getHttpServer())
      .get("/me")
      .set(bearer(before.body.token as string));
    expect(me.status).toBe(401);
    expect(me.body.key).toBe("errors.accountDeactivated");
  });

  it("is closed to everybody who is not an administrator", async () => {
    const admins = await tokenFor(app, USERS.admin);
    const target = await makeUser(admins, {
      username: `notyours.${unique()}`,
      roles: ["technician"],
      orgUnitIds: ["nicosia-general"],
    });

    for (const email of [USERS.estatesNicosia, USERS.engineerLarnaca, USERS.finance, USERS.auditor, USERS.executive]) {
      const token = await tokenFor(app, email);
      const routes: (() => Promise<{ status: number; body: { key?: string } }>)[] = [
        () => request(app.getHttpServer()).get("/admin/users").set(bearer(token)),
        () => request(app.getHttpServer()).get("/admin/roles").set(bearer(token)),
        () => request(app.getHttpServer()).get(`/admin/users/${target.id}`).set(bearer(token)),
        () =>
          request(app.getHttpServer())
            .post("/admin/users")
            .set(bearer(token))
            .send({ username: "x", roles: [], orgUnitIds: [] }),
        () =>
          request(app.getHttpServer())
            .patch(`/admin/users/${target.id}`)
            .set(bearer(token))
            .send({ active: false }),
      ];
      for (const route of routes) {
        const response = await route();
        expect(response.status).toBe(403);
        expect(response.body.key).toBe("errors.notAllowed");
      }
    }
  });

  it("refuses a caller with no token, a body that is not a user and an id that is not one", async () => {
    const anonymous = await request(app.getHttpServer()).get("/admin/users");
    expect(anonymous.status).toBe(401);

    const token = await tokenFor(app, USERS.admin);
    const bad = await post(token, { username: "", roles: ["not-a-role"] });
    expect(bad.status).toBe(400);
    expect(bad.body.key).toBe("errors.adminUserNotValid");

    const missing = await request(app.getHttpServer())
      .get("/admin/users/not-a-uuid")
      .set(bearer(token));
    expect(missing.status).toBe(404);
    expect(missing.body.key).toBe("errors.adminUserNotFound");
  });
});
