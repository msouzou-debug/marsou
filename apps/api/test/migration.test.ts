import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate";

/**
 * The migration has to survive both things that happen to it in real life:
 * a brand-new database on a new server, and somebody running the command
 * twice because they were not sure it took the first time.
 */
describe("migrations", () => {
  const dbName = "ecapital_migration_test";
  let adminUrl: string;
  let targetUrl: string;

  beforeAll(async () => {
    adminUrl = process.env.ECAPITAL_TEST_ADMIN_URL as string;
    targetUrl = adminUrl.replace(/\/postgres$/, `/${dbName}`);
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.query(`create database ${dbName}`);
    await admin.end();
  });

  afterAll(async () => {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  });

  it("applies from an empty database", async () => {
    const result = await runMigrations(targetUrl);
    expect(result.applied).toContain("0001_m0_foundations");
    expect(result.applied).toContain("0002_m1_projects");
    expect(result.applied).toContain("0003_m1_contracts");
    expect(result.applied).toContain("0004_audit_skip_noop_updates");
    expect(result.applied).toContain("0005_m1_import");
    expect(result.lastMigrationId).toBe("0005_m1_import");

    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'ecapital' order by table_name",
    );
    await client.end();
    expect(rows.map((r) => r.table_name)).toEqual([
      "app_user",
      "app_user_org_unit",
      "app_user_role",
      "area",
      "audit_log",
      "boq_item",
      "budget_line",
      "building",
      "contract",
      "contractor",
      "cost_txn",
      "floor",
      "import_batch",
      "import_exception",
      "issue",
      "milestone",
      "org_unit",
      "org_unit_alias",
      "project",
      "project_code_seq",
      "project_note",
      "risk",
      "role_mapping",
      "schema_migration",
      "variation",
    ]);
  });

  it("is a no-op on a second run", async () => {
    const before = await snapshot(targetUrl);
    const result = await runMigrations(targetUrl);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain("0001_m0_foundations");
    expect(result.skipped).toContain("0002_m1_projects");
    expect(result.skipped).toContain("0003_m1_contracts");
    expect(result.skipped).toContain("0004_audit_skip_noop_updates");
    expect(result.skipped).toContain("0005_m1_import");
    expect(await snapshot(targetUrl)).toEqual(before);
  });

  it("leaves row-level security on every table that has a policy", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    const { rows } = await client.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'ecapital' and c.relkind = 'r' and c.relname <> 'schema_migration'`,
    );
    await client.end();
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it("gives the application role no way to change the audit log", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    const { rows } = await client.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.table_privileges
        where table_schema = 'ecapital' and table_name = 'audit_log' and grantee = 'ecapital_app'`,
    );
    await client.end();
    expect(rows.map((r) => r.privilege_type).sort()).toEqual(["SELECT"]);
  });
});

/** Everything about the schema that a second run could plausibly change. */
async function snapshot(url: string): Promise<unknown> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const columns = await client.query(
      `select table_name, column_name, data_type, is_nullable, column_default
         from information_schema.columns where table_schema = 'ecapital'
        order by table_name, column_name`,
    );
    const policies = await client.query(
      "select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'ecapital' order by tablename, policyname",
    );
    const triggers = await client.query(
      `select event_object_table, trigger_name, event_manipulation, action_timing
         from information_schema.triggers where trigger_schema = 'ecapital'
        order by event_object_table, trigger_name, event_manipulation`,
    );
    const migrations = await client.query("select id, checksum from ecapital.schema_migration order by id");
    return {
      columns: columns.rows,
      policies: policies.rows,
      triggers: triggers.rows,
      migrations: migrations.rows,
    };
  } finally {
    await client.end();
  }
}
