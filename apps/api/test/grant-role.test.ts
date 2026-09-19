import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate";
import { describe as describeResult, grantRole, parseArgs } from "../src/cli/grant-role";

/**
 * ADR-0020 — the bootstrap CLI.
 *
 * This runs against a database of its own, migrated and otherwise empty,
 * because that is the situation the CLI exists for: a fresh ΟΚΥπΥ server with
 * no administrator in it and therefore no way in through the screen. The
 * seeded development database would prove nothing about that.
 */
describe("grant-admin / grant-role on an empty database", () => {
  const dbName = `ecapital_bootstrap_${Date.now()}`;
  let adminUrl: string;
  let targetUrl: string;
  let db: Client;

  beforeAll(async () => {
    adminUrl = process.env.ECAPITAL_TEST_ADMIN_URL as string;
    targetUrl = adminUrl.replace(/\/postgres$/, `/${dbName}`);
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.query(`create database ${dbName}`);
    await admin.end();

    await runMigrations(targetUrl);
    db = new Client({ connectionString: targetUrl });
    await db.connect();
    // One unit, so the all-units expansion has something to expand to.
    await db.query(
      `insert into ecapital.org_unit (id, code, name_el, name_en, type, directorate)
            values ('nicosia-general', 'NGH', 'Γενικό Νοσοκομείο Λευκωσίας', 'Nicosia General Hospital', 'HOSPITAL', 'LEFKOSIAS')`,
    );
  });

  afterAll(async () => {
    await db.end();
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  });

  it("creates the first administrator where there is none", async () => {
    const before = await db.query("select 1 from ecapital.app_user");
    expect(before.rowCount).toBe(0);

    const result = await grantRole({
      connectionString: targetUrl,
      username: "IT.Admin",
      role: "admin",
      name: "Μαρία Κωνσταντίνου",
      actor: "cli:deploy",
    });

    expect(result.account).toBe("created");
    expect(result.changed).toBe(true);
    // RULE (ADR-0020): the subject is the account name until the first bind
    // hands over an objectGUID.
    expect(result.subject).toBe("ad:it.admin");
    // An all-units role carries every unit, which is what makes `finance`
    // work and does no harm to `admin`.
    expect(result.orgUnitIds).toEqual(["nicosia-general"]);
    expect(describeResult(result)).toContain("role admin: granted");

    const { rows } = await db.query<{ role: string; is_active: boolean; username: string }>(
      `select r.role::text as role, u.is_active, u.username
         from ecapital.app_user u
         join ecapital.app_user_role r on r.app_user_id = u.id`,
    );
    expect(rows).toEqual([{ role: "admin", is_active: true, username: "IT.Admin" }]);
  });

  it("records the run in the audit log under the operating-system account", async () => {
    // R42: the triggers are on the tables, not on a route, so there is no
    // way to run the CLI without leaving the trail.
    const { rows } = await db.query<{ actor_id: string; entity_type: string }>(
      `select actor_id, entity_type from ecapital.audit_log
        where entity_type in ('app_user', 'app_user_role', 'app_user_org_unit')
        order by id`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.actor_id === "cli:deploy")).toBe(true);
    expect(rows.map((r) => r.entity_type)).toContain("app_user_role");
  });

  it("is idempotent, and finds the account the second time", async () => {
    const again = await grantRole({
      connectionString: targetUrl,
      username: "it.admin",
      role: "admin",
      actor: "cli:deploy",
    });
    expect(again.account).toBe("found");
    expect(again.changed).toBe(false);
    expect(describeResult(again)).toContain("already held");
  });

  it("appoints the auditor — the one role the screen refuses in both directions", async () => {
    const appointed = await grantRole({
      connectionString: targetUrl,
      username: "c.loizou",
      role: "auditor_readonly",
      name: "Χριστίνα Λοΐζου",
      actor: "cli:deploy",
    });
    expect(appointed.changed).toBe(true);

    const revoked = await grantRole({
      connectionString: targetUrl,
      username: "c.loizou",
      role: "auditor_readonly",
      revoke: true,
      actor: "cli:deploy",
    });
    expect(revoked.changed).toBe(true);
    expect(describeResult(revoked)).toContain("role auditor_readonly: revoked");

    const { rows } = await db.query(
      `select 1 from ecapital.app_user_role r
         join ecapital.app_user u on u.id = r.app_user_id
        where lower(u.username) = 'c.loizou'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses a role that is not one of the eight", () => {
    // RULE (ADR-0020): a typo must not reach Postgres as an enum cast error.
    const args = parseArgs(["--username", "somebody", "--role", "superuser"]);
    expect(args.unknownRole).toBe("superuser");
    expect(args.role).toBeNull();

    const good = parseArgs(["--", "--username", "somebody", "--role", "finance"]);
    expect(good.role).toBe("finance");
    expect(good.username).toBe("somebody");

    // `grant-admin` needs no --role at all.
    expect(parseArgs(["--username", "somebody"], "admin").role).toBe("admin");
  });
});
