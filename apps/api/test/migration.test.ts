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
    expect(result.applied).toContain("0006_m1_site_logs");
    expect(result.applied).toContain("0005_m1_import");
    expect(result.lastMigrationId).toBe("0006_m1_site_logs");

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
      "defect",
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
      "rfi",
      "risk",
      "role_mapping",
      "schema_migration",
      "site_instruction",
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
    expect(result.skipped).toContain("0006_m1_site_logs");
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

  /**
   * ADR-0015 and ADR-0017: the rules that are written twice. Each of these is
   * also a service rule with a sentence behind it; the constraint is what
   * makes the rule true of the importer and the repair script as well.
   */
  it("keeps the site log's rules as constraints and not only as service code", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    const { rows } = await client.query<{ conname: string }>(
      `select c.conname from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'ecapital'
          and t.relname in ('rfi', 'site_instruction', 'defect')
          and c.contype = 'c'
        order by c.conname`,
    );
    await client.end();
    const names = rows.map((r) => r.conname);
    // R09: an RFI is closed after it has been answered.
    expect(names).toContain("rfi_answered_before_closed");
    // R09: only a cost-impact instruction turns into a variation.
    expect(names).toContain("site_instruction_variation_needs_cost_impact");
    // R35: funded means a capital project is paying for it.
    expect(names).toContain("defect_funded_needs_project");
  });

  it("gives a technician the two defect sources the field produces and no others", async () => {
    // ADR-0017. The policy is the rule; this asserts it exists and reads the
    // row's own source column, which no other policy in the schema does.
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    const { rows } = await client.query<{ qual: string; with_check: string }>(
      "select qual, with_check from pg_policies where schemaname = 'ecapital' and tablename = 'defect' and policyname = 'defect_write'",
    );
    const { rows: fn } = await client.query<{ src: string }>(
      "select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'ecapital' and p.proname = 'can_manage_defect'",
    );
    await client.end();
    expect(rows).toHaveLength(1);
    expect(rows[0].qual).toContain("can_manage_defect");
    expect(rows[0].with_check).toContain("can_manage_defect");
    expect(fn[0].src).toContain("technician");
    expect(fn[0].src).toContain("INSPECTION");
    expect(fn[0].src).toContain("WORK_ORDER");
    expect(fn[0].src).not.toContain("HANDOVER");
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
