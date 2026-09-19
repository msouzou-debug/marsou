import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations, runMigrations } from "../src/db/migrate";

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
    expect(result.applied).toContain("0007_active_directory_sign_in");
    expect(result.applied).toContain("0008_entity_codes_and_contract_refs");
    expect(result.applied).toContain("0009_hq_unit");
    expect(result.applied).toContain("0010_admin_users");
    expect(result.applied).toContain("0011_m2_cost");
    expect(result.applied).toContain("0012_unit_codes_earchive");
    expect(result.applied).toContain("0014_earchive_outbox");
    expect(result.applied).toContain("0015_m3_permits");
    expect(result.applied).toContain("0016_permit_partial_draft");
    expect(result.lastMigrationId).toBe("0016_permit_partial_draft");

    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'ecapital' order by table_name",
    );
    await client.end();
    expect(rows.map((r) => r.table_name)).toEqual([
      "allocation_rule",
      "app_user",
      "app_user_org_unit",
      "app_user_role",
      "area",
      "area_clinical_owner",
      "audit_log",
      "boq_item",
      "budget_code",
      "budget_line",
      "building",
      "contract",
      "contract_ref_seq",
      "contractor",
      "cost_txn",
      "cost_warning",
      "defect",
      "dms_event",
      "dms_outbox",
      "document",
      "email_outbox",
      "floor",
      "forecast_inputs",
      "icra_matrix_cell",
      "icra_matrix_version",
      "import_batch",
      "import_exception",
      "inbox_read",
      "issue",
      "milestone",
      "org_unit",
      "org_unit_alias",
      "payment_cert",
      "permit_approval",
      "permit_ref_seq",
      "project",
      "project_code_seq",
      "project_note",
      "rfi",
      "risk",
      "role_mapping",
      "schema_migration",
      "shutdown_permit",
      "shutdown_permit_area",
      "site_instruction",
      "system_feed",
      "unit_approver",
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
    expect(result.skipped).toContain("0007_active_directory_sign_in");
    expect(result.skipped).toContain("0008_entity_codes_and_contract_refs");
    expect(result.skipped).toContain("0009_hq_unit");
    expect(result.skipped).toContain("0010_admin_users");
    expect(result.skipped).toContain("0011_m2_cost");
    expect(result.skipped).toContain("0012_unit_codes_earchive");
    expect(result.skipped).toContain("0014_earchive_outbox");
    expect(result.skipped).toContain("0015_m3_permits");
    expect(result.skipped).toContain("0016_permit_partial_draft");
    expect(await snapshot(targetUrl)).toEqual(before);
  });

  it("0009_hq_unit adds both enum values and is a no-op the second time", async () => {
    // The migration itself only widens two enums (the HQ row is the seed's
    // job, not this migration's — see the file's own header comment). What
    // has to be true after it, on a fresh database and again after a second
    // run: both new values exist, in both enums, exactly once.
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    const { rows } = await client.query<{ typname: string; enumlabel: string }>(
      `select t.typname, e.enumlabel
         from pg_enum e join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'ecapital' and t.typname in ('org_unit_type', 'directorate')
        order by t.typname, e.enumsortorder`,
    );
    await client.end();
    const orgUnitTypeLabels = rows.filter((r) => r.typname === "org_unit_type").map((r) => r.enumlabel);
    const directorateLabels = rows.filter((r) => r.typname === "directorate").map((r) => r.enumlabel);
    expect(orgUnitTypeLabels).toEqual(["HOSPITAL", "SERVICE", "CENTRAL"]);
    expect(directorateLabels).toEqual([
      "LEMESOU_PAFOU",
      "LEFKOSIAS",
      "LARNAKAS_AMMOCHOSTOU",
      "DYPSY",
      "PFY",
      "AMBULANCE",
      "KENTRIKI_DIOIKISI",
    ]);
  });

  /**
   * ADR-0024, the owner's two decisions of 19/09/2026. This one is not about
   * the shape of the schema but about rows that already exist, so it runs on
   * its own database: everything up to 0011, then a register seeded the way a
   * live one looks today — old codes, old project codes, an ambulance unit
   * with a project, a contract and a defect hanging off it — and only then
   * 0012.
   */
  it("0012 moves the codes to eArchive's and takes the ambulance unit with its rows", async () => {
    const legacyDb = "ecapital_migration_0012_test";
    const legacyUrl = adminUrl.replace(/\/postgres$/, `/${legacyDb}`);

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${legacyDb}`);
    await admin.query(`create database ${legacyDb}`);
    await admin.end();

    const client = new Client({ connectionString: legacyUrl });
    await client.connect();
    try {
      const files = readMigrations();
      const upTo0011 = files.filter((m) => m.id < "0012");
      const zeroZeroOneTwo = files.find((m) => m.id === "0012_unit_codes_earchive");
      expect(zeroZeroOneTwo).toBeDefined();

      await client.query("create schema if not exists ecapital");
      for (const migration of upTo0011) await client.query(migration.sql);

      // A register with the codes as they were before ADR-0024. Two units
      // whose code moves, one whose code does not, and the ambulance unit.
      await client.query(`
        insert into ecapital.org_unit (id, code, name_el, name_en, type, directorate, entity_code)
        values ('troodos', 'TRD', 'Νοσοκομείο Τροόδους', 'Troodos Hospital', 'HOSPITAL', 'LEMESOU_PAFOU', 'TRD'),
               ('pfy', 'PFY', 'Πρωτοβάθμια Φροντίδα Υγείας', 'Primary Healthcare', 'SERVICE', 'PFY', 'HC'),
               ('nicosia-general', 'NGH', 'Γενικό Νοσοκομείο Λευκωσίας', 'Nicosia General Hospital', 'HOSPITAL', 'LEFKOSIAS', 'NGH'),
               ('ambulance', 'AMB', 'Υπηρεσία Ασθενοφόρων', 'Ambulance Service', 'SERVICE', 'AMBULANCE', 'AMB')`);
      await client.query(
        `insert into ecapital.org_unit_alias (org_unit_id, alias) values ('ambulance', 'ΥΠΗΡΕΣΙΑ ΑΣΘΕΝΟΦΟΡΩΝ')`,
      );
      await client.query(`
        insert into ecapital.project (code, org_unit_id, title_el, category, phase, approved_budget)
        values ('TRD-2026-001', 'troodos', 'Αντικατάσταση ψυκτικών μονάδων', 'MAINTENANCE_CAPITAL', 'IN_PROGRESS', 100000),
               ('PFY-2026-004', 'pfy', 'Αντικατάσταση ανελκυστήρων', 'MAINTENANCE_CAPITAL', 'IDEA', 50000),
               ('NGH-2026-002', 'nicosia-general', 'Επέκταση ΤΑΕΠ', 'NEW_BUILD', 'IDEA', 90000),
               ('AMB-2026-001', 'ambulance', 'Αντικατάσταση οχημάτων', 'EQUIPMENT', 'AWARDED', 70000)`);
      // The counter ADR-0014 keys by unit and year, not by code.
      await client.query(
        `insert into ecapital.project_code_seq (org_unit_id, year, next_seq)
         values ('troodos', 2026, 2), ('ambulance', 2026, 2)`,
      );
      await client.query(
        `insert into ecapital.contractor (name, vat_number, registration_no, category)
         values ('Δοκιμαστική Εργοληπτική Λτδ', 'CY10000001X', 'HE 100001', 'BUILDING')`,
      );
      await client.query(`
        insert into ecapital.contract
          (project_id, org_unit_id, contractor_id, contract_no, type, award_date, original_value, ref)
        select p.id, p.org_unit_id, c.id, 'ΤΥ/2026/900', 'SUPPLY', date '2026-02-01', 70000, 'CAP-2026-0900'
          from ecapital.project p, ecapital.contractor c
         where p.code = 'AMB-2026-001'`);

      await client.query(zeroZeroOneTwo!.sql);

      // 1. The codes are eArchive's, on both columns, and the names did not move.
      const { rows: units } = await client.query<{
        id: string;
        code: string;
        entity_code: string;
        name_el: string;
      }>("select id, code, entity_code, name_el from ecapital.org_unit order by id");
      expect(units.map((u) => u.id)).toEqual(["nicosia-general", "pfy", "troodos"]);
      const byId = new Map(units.map((u) => [u.id, u]));
      expect(byId.get("troodos")).toMatchObject({
        code: "KYP",
        entity_code: "KYP",
        name_el: "Νοσοκομείο Τροόδους",
      });
      expect(byId.get("pfy")).toMatchObject({ code: "PHC", entity_code: "PHC" });
      expect(byId.get("nicosia-general")).toMatchObject({ code: "NGH", entity_code: "NGH" });

      // 2. The project codes follow the prefix and keep their year and number.
      const { rows: projects } = await client.query<{ code: string }>(
        "select code from ecapital.project order by code",
      );
      expect(projects.map((p) => p.code)).toEqual([
        "KYP-2026-001",
        "NGH-2026-002",
        "PHC-2026-004",
      ]);

      // 3. The ambulance unit is gone, and so is everything under it.
      for (const [table, where] of [
        ["org_unit", "id = 'ambulance'"],
        ["org_unit_alias", "org_unit_id = 'ambulance'"],
        ["project", "org_unit_id = 'ambulance'"],
        ["contract", "org_unit_id = 'ambulance'"],
        ["project_code_seq", "org_unit_id = 'ambulance'"],
      ] as const) {
        const { rows } = await client.query<{ n: string }>(
          `select count(*)::text as n from ecapital.${table} where ${where}`,
        );
        expect(Number(rows[0].n), table).toBe(0);
      }

      // 4. The counter is keyed by unit, so Troodos keeps its place in the run
      //    and the next code it issues carries the new prefix.
      const { rows: next } = await client.query<{ code: string }>(
        "select ecapital.allocate_project_code('troodos', 2026) as code",
      );
      expect(next[0].code).toBe("KYP-2026-002");

      // 5. The importer's rule list has room for V15 (CAPEX-03 errata).
      const { rows: check } = await client.query<{ def: string }>(
        `select pg_get_constraintdef(c.oid) as def from pg_constraint c
           join pg_class t on t.oid = c.conrelid
          where t.relname = 'import_exception' and c.conname = 'import_exception_rule_known'`,
      );
      expect(check[0].def).toContain("'V15'");
    } finally {
      await client.end();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${legacyDb}`);
      await cleanup.end();
    }
  }, 180_000);

  /**
   * ADR-0025, owner decision 19/09/2026: one CAPEX budget code per contract,
   * chosen from a reference table eCapital carries until eFinance's
   * `GET /api/v1/master/budget-codes?kind=capex` exists.
   */
  it("0013 seeds twenty CAPEX budget codes and gives the contract a nullable column pointing at them", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    const { rows } = await client.query<{
      code: string;
      description_el: string;
      is_capex: boolean;
      active: boolean;
      source: string;
    }>(
      "select code, description_el, is_capex, active, source from ecapital.budget_code order by code",
    );

    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.is_capex && r.active && r.source === "SEED")).toBe(true);

    // The five the owner named by number and description carry no
    // placeholder marker; the other fifteen do.
    const byCode = new Map(rows.map((r) => [r.code, r]));
    expect(byCode.get("7402")?.description_el).toBe("Ιατρικός και λοιπός εξοπλισμός");
    expect(byCode.get("7501")?.description_el).toBe("Μηχανήματα και εξοπλισμός");
    expect(byCode.get("7502")?.description_el).toBe("Κλιματισμός");
    expect(byCode.get("7551")?.description_el).toBe("Επιβατικά οχήματα");
    expect(byCode.get("7585")?.description_el).toBe("Ασθενοφόρα");
    const namedFive = new Set(["7402", "7501", "7502", "7551", "7585"]);
    for (const row of rows) {
      if (namedFive.has(row.code)) {
        expect(row.description_el).not.toContain("προσωρινή περιγραφή");
      } else {
        expect(row.description_el).toContain("προσωρινή περιγραφή");
      }
    }

    const { rows: fk } = await client.query<{ conname: string; confrelid: string }>(
      `select c.conname, tf.relname as confrelid
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_class tf on tf.oid = c.confrelid
        where t.relname = 'contract' and c.contype = 'f' and tf.relname = 'budget_code'`,
    );
    await client.end();
    expect(fk).toHaveLength(1);
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

  /**
   * 0014, the eArchive outbox (ADR-0023). Three tables, and the two rules a
   * reader of the ADR would want to see written down somewhere that runs:
   * a source_ref is unique so the same item cannot be filed twice, and the
   * queue and the callbacks belong to the service and not to a unit.
   */
  it("0014 gives the document its eArchive columns and its unique source_ref", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const { rows: columns } = await client.query<{ column_name: string; column_default: string }>(
        `select column_name, column_default from information_schema.columns
          where table_schema = 'ecapital' and table_name = 'document' order by column_name`,
      );
      const names = columns.map((c) => c.column_name);
      // CAPEX-01 §4's line, then the eArchive contract on the end of it.
      for (const column of [
        "id", "entity_type", "entity_id", "kind", "title_el", "mime", "size", "sha256",
        "version", "object_key",
        "protocol_id", "protocol_number", "legal_hold", "deleted_at", "source_ref",
      ]) {
        expect(names, column).toContain(column);
      }
      expect(columns.find((c) => c.column_name === "legal_hold")?.column_default).toBe("false");

      // A source_ref is the key eArchive files by. Twice is a mistake.
      const { rows: unique } = await client.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = 'ecapital' and tablename = 'document'
            and indexdef like '%source_ref%'`,
      );
      expect(unique.some((u) => u.indexdef.includes("UNIQUE"))).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("0014 makes the callback idempotent at the table, not only in the controller", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ def: string }>(
        `select pg_get_constraintdef(c.oid) as def from pg_constraint c
           join pg_class t on t.oid = c.conrelid
           join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = 'ecapital' and t.relname = 'dms_event' and c.conname = 'dms_event_once'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].def).toContain("UNIQUE");
      for (const column of ["event", "protocol_id", "at"]) {
        expect(rows[0].def, column).toContain(column);
      }
    } finally {
      await client.end();
    }
  });

  it("0014 keeps the queue and the callbacks off every unit-scoped account", async () => {
    // «Service-only, admin read»: there is a SELECT policy for the
    // administrator and the auditor and no write policy at all, because every
    // write goes through a SECURITY DEFINER function.
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ tablename: string; policyname: string; cmd: string; qual: string }>(
        `select tablename, policyname, cmd, qual from pg_policies
          where schemaname = 'ecapital' and tablename in ('dms_outbox', 'dms_event')
          order by tablename, policyname`,
      );
      expect(rows.map((r) => `${r.tablename}.${r.cmd}`)).toEqual([
        "dms_event.SELECT",
        "dms_outbox.SELECT",
      ]);
      for (const row of rows) {
        expect(row.qual, row.tablename).toContain("admin");
        expect(row.qual, row.tablename).toContain("auditor_readonly");
      }

      // And a document is read by whoever may read its unit, as everything
      // else that belongs to a unit is (ADR-0010).
      const { rows: doc } = await client.query<{ policyname: string; qual: string; with_check: string }>(
        `select policyname, qual, with_check from pg_policies
          where schemaname = 'ecapital' and tablename = 'document' order by policyname`,
      );
      expect(doc.map((d) => d.policyname)).toEqual(["document_read", "document_write"]);
      expect(doc[0].qual).toContain("can_read_unit");
      expect(doc[1].with_check).toContain("can_manage_document");
    } finally {
      await client.end();
    }
  });

  it("0014 audits all three of its tables", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ event_object_table: string; trigger_name: string }>(
        `select distinct event_object_table, trigger_name from information_schema.triggers
          where trigger_schema = 'ecapital'
            and event_object_table in ('document', 'dms_outbox', 'dms_event')
            and trigger_name like '%_audit'
          order by event_object_table`,
      );
      expect(rows.map((r) => r.event_object_table)).toEqual([
        "dms_event",
        "dms_outbox",
        "document",
      ]);
    } finally {
      await client.end();
    }
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
