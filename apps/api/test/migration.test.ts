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
    expect(result.applied).toContain("0017_m4_assets");
    expect(result.applied).toContain("0018_cns_unit_and_efinance_codes");
    expect(result.applied).toContain("0019_cns_name_matches_earchive");
    expect(result.applied).toContain("0020_efinance_client");
    expect(result.applied).toContain("0021_local_accounts");
    expect(result.applied).toContain("0022_m5_maintenance");
    expect(result.applied).toContain("0024_unit_codes_follow_efinance");
    expect(result.applied).toContain("0025_delay_extensions_claims");
    expect(result.applied).toContain("0027_unit_people");
    expect(result.applied).toContain("0028_project_cashflow_plan");
    expect(result.applied).toContain("0029_claim_documents");
    expect(result.applied).toContain("0030_rfi_recipient_and_sap_asset_class");
    expect(result.applied).toContain("0031_vat");
    expect(result.applied).toContain("0032_rfi_close_and_contractor_contact");
    expect(result.applied).toContain("0033_technical_approver_role");
    expect(result.applied).toContain("0034_site_instruction_mail");
    expect(result.applied).toContain("0035_permit_handback");
    expect(result.applied).toContain("0036_approver_eligibility");
    expect(result.lastMigrationId).toBe("0036_approver_eligibility");

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
      "app_user_password",
      "app_user_role",
      "area",
      "area_clinical_owner",
      "asset",
      "asset_document",
      "asset_reading",
      "asset_tag_seq",
      "audit_log",
      "backlog_item",
      "boq_item",
      "budget_code",
      "budget_line",
      "building",
      "contract",
      "contract_claim",
      "contract_extension",
      "contract_ref_seq",
      "contract_section",
      "contractor",
      "cost_txn",
      "cost_warning",
      "defect",
      "dms_event",
      "dms_outbox",
      "document",
      "efinance_invoice",
      "efinance_invoice_line",
      "efinance_requisition",
      "efinance_sync_state",
      "efinance_vendor",
      "email_outbox",
      "floor",
      "forecast_inputs",
      "icra_matrix_cell",
      "icra_matrix_version",
      "import_batch",
      "import_exception",
      "inbox_read",
      "issue",
      "maintenance_contract",
      "milestone",
      "org_unit",
      "org_unit_alias",
      "payment_cert",
      "permit_approval",
      "permit_ref_seq",
      "pm_schedule",
      "project",
      "project_cashflow_plan",
      "project_code_seq",
      "project_note",
      "rfi",
      "risk",
      "role_mapping",
      "role_permission",
      "sap_asset_class",
      "schema_migration",
      "shutdown_permit",
      "shutdown_permit_area",
      "site_instruction",
      "sla_system",
      "system_feed",
      "unit_approver",
      "variation",
      "work_order",
      "work_order_event",
      "work_order_ref_seq",
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
    expect(result.skipped).toContain("0017_m4_assets");
    expect(result.skipped).toContain("0018_cns_unit_and_efinance_codes");
    expect(result.skipped).toContain("0019_cns_name_matches_earchive");
    expect(result.skipped).toContain("0020_efinance_client");
    expect(result.skipped).toContain("0021_local_accounts");
    expect(result.skipped).toContain("0022_m5_maintenance");
    expect(result.skipped).toContain("0024_unit_codes_follow_efinance");
    expect(result.skipped).toContain("0025_delay_extensions_claims");
    expect(result.skipped).toContain("0027_unit_people");
    expect(result.skipped).toContain("0028_project_cashflow_plan");
    expect(result.skipped).toContain("0029_claim_documents");
    expect(result.skipped).toContain("0030_rfi_recipient_and_sap_asset_class");
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

  /**
   * The owner's two decisions of 20/09/2026: CNS gets its own unit rather
   * than filing under HQ, and eFinance's own entity keys are carried
   * permanently alongside eArchive's, not translated into them. Run on its
   * own database, the same way 0012's test is: everything up to 0017, then a
   * register seeded the way a live one looks today, and only then 0018.
   */
  it("0018 adds the CNS unit and backfills eFinance's own entity codes", async () => {
    const legacyDb = "ecapital_migration_0018_test";
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
      const upTo0017 = files.filter((m) => m.id < "0018");
      const zeroZeroOneEight = files.find((m) => m.id === "0018_cns_unit_and_efinance_codes");
      expect(zeroZeroOneEight).toBeDefined();

      await client.query("create schema if not exists ecapital");
      for (const migration of upTo0017) await client.query(migration.sql);

      // A register as ADR-0024 left it: eArchive codes on both columns,
      // nothing in efinance_code yet.
      await client.query(`
        insert into ecapital.org_unit (id, code, name_el, name_en, type, directorate, entity_code)
        values ('nicosia-general', 'NGH', 'Γενικό Νοσοκομείο Λευκωσίας', 'Nicosia General Hospital', 'HOSPITAL', 'LEFKOSIAS', 'NGH'),
               ('paphos-general', 'PAF', 'Γενικό Νοσοκομείο Πάφου', 'Paphos General Hospital', 'HOSPITAL', 'LEMESOU_PAFOU', 'PAF'),
               ('troodos', 'KYP', 'Νοσοκομείο Τροόδους', 'Troodos Hospital', 'HOSPITAL', 'LEMESOU_PAFOU', 'KYP'),
               ('hq', 'HQ', 'Κεντρικά Γραφεία', 'Central Offices', 'CENTRAL', 'KENTRIKI_DIOIKISI', 'HQ')`);

      await client.query(zeroZeroOneEight!.sql);

      // 1. eFinance's own codes are backfilled, differing where ADR-0024
      //    moved eCapital's own code away from them, equal where it did not.
      const { rows: units } = await client.query<{ id: string; efinance_code: string | null }>(
        "select id, efinance_code from ecapital.org_unit where id <> 'community-nursing' order by id",
      );
      const byId = new Map(units.map((u) => [u.id, u.efinance_code]));
      expect(byId.get("nicosia-general")).toBe("NGH");
      expect(byId.get("paphos-general")).toBe("PAP");
      expect(byId.get("troodos")).toBe("TRD");
      expect(byId.get("hq")).toBe("HQ");

      // 2. CNS is a real unit now, not a gap that files under HQ.
      const { rows: cns } = await client.query<{
        code: string;
        name_el: string;
        name_en: string;
        type: string;
        directorate: string;
        cost_centre: string | null;
        entity_code: string;
        efinance_code: string;
      }>(
        `select code, name_el, name_en, type, directorate, cost_centre, entity_code, efinance_code
           from ecapital.org_unit where id = 'community-nursing'`,
      );
      expect(cns).toHaveLength(1);
      expect(cns[0]).toMatchObject({
        code: "CNS",
        name_el: "Κοινοτική Νοσηλευτική Υπηρεσία",
        name_en: "Community Nursing Service",
        type: "SERVICE",
        directorate: "PFY",
        cost_centre: null,
        entity_code: "CNS",
        efinance_code: "CNS",
      });

      // 3. Idempotent: running it again inserts no duplicate and changes
      //    nothing already correct.
      await client.query(zeroZeroOneEight!.sql);
      const { rows: count } = await client.query<{ n: string }>(
        "select count(*)::text as n from ecapital.org_unit where id = 'community-nursing'",
      );
      expect(Number(count[0].n)).toBe(1);

      // 4. 0019 renames the row to eArchive's folder name (owner decision,
      //    21/09/2026) and is idempotent on its own guard.
      const zeroZeroOneNine = files.find((m) => m.id === "0019_cns_name_matches_earchive");
      expect(zeroZeroOneNine).toBeDefined();
      await client.query(zeroZeroOneNine!.sql);
      await client.query(zeroZeroOneNine!.sql);
      const { rows: renamed } = await client.query<{ name_el: string; name_en: string }>(
        "select name_el, name_en from ecapital.org_unit where id = 'community-nursing'",
      );
      expect(renamed).toEqual([{ name_el: "Κοινοτική Νοσηλευτική", name_en: "Community Nursing" }]);
    } finally {
      await client.end();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${legacyDb}`);
      await cleanup.end();
    }
  }, 180_000);

  it("0024 moves six codes and two names to eFinance's and leaves every reference as issued", async () => {
    const legacyDb = "ecapital_migration_0024_test";
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
      const upTo0023 = files.filter((m) => m.id < "0024");
      const zeroZeroTwoFour = files.find((m) => m.id === "0024_unit_codes_follow_efinance");
      expect(zeroZeroTwoFour).toBeDefined();

      await client.query("create schema if not exists ecapital");
      for (const migration of upTo0023) await client.query(migration.sql);

      // A register as ADR-0024 and 0018 left it: eArchive's codes on `code`
      // and `entity_code`, eFinance's on `efinance_code`, and one project
      // and one work order already issued under the old prefix.
      await client.query(`
        insert into ecapital.org_unit (id, code, name_el, name_en, type, directorate, entity_code, efinance_code)
        values ('nicosia-general', 'NGH', 'Γενικό Νοσοκομείο Λευκωσίας', 'Nicosia General Hospital', 'HOSPITAL', 'LEFKOSIAS', 'NGH', 'NGH'),
               ('troodos', 'KYP', 'Νοσοκομείο Τροόδους', 'Troodos Hospital', 'HOSPITAL', 'LEMESOU_PAFOU', 'KYP', 'TRD'),
               ('namiii', 'NAM', 'Νοσοκομείο Αρχιεπίσκοπος Μακάριος Γ΄', 'Archbishop Makarios III Hospital', 'HOSPITAL', 'LEFKOSIAS', 'NAM', 'ARC'),
               ('pfy', 'PHC', 'Πρωτοβάθμια Φροντίδα Υγείας', 'Primary Healthcare', 'SERVICE', 'PFY', 'PHC', null)`);
      await client.query(`
        insert into ecapital.project (id, org_unit_id, code, title_el, category, phase, approved_budget)
        values ('00000000-0000-4000-8000-000000000024', 'troodos',
                ecapital.allocate_project_code('troodos', 2026), 'Παλιό έργο', 'SMALL_WORKS', 'IDEA', 1000)`);
      const { rows: issued } = await client.query<{ code: string }>(
        "select code from ecapital.project where id = '00000000-0000-4000-8000-000000000024'",
      );
      expect(issued[0].code).toBe("KYP-2026-001");

      await client.query(zeroZeroTwoFour!.sql);

      // 1. Six codes and two names, eFinance's; untouched units untouched.
      const { rows: units } = await client.query<{
        id: string; code: string; entity_code: string; efinance_code: string; name_el: string; name_en: string;
      }>("select id, code, entity_code, efinance_code, name_el, name_en from ecapital.org_unit order by id");
      const byId = new Map(units.map((u) => [u.id, u]));
      expect(byId.get("nicosia-general")).toMatchObject({ code: "NGH", entity_code: "NGH", efinance_code: "NGH" });
      expect(byId.get("troodos")).toMatchObject({ code: "TRD", entity_code: "TRD", efinance_code: "TRD", name_el: "Νοσοκομείο Τροόδους" });
      expect(byId.get("namiii")).toMatchObject({ code: "ARC", entity_code: "ARC", efinance_code: "ARC", name_el: "Νοσοκομείο Αρχιεπίσκοπος Μακάριος ΙΙΙ" });
      expect(byId.get("pfy")).toMatchObject({ code: "HC", entity_code: "HC", efinance_code: "HC", name_el: "Κέντρα Υγείας", name_en: "Health Centres" });
      for (const unit of units) {
        expect(unit.entity_code).toBe(unit.code);
        expect(unit.efinance_code).toBe(unit.code);
      }

      // 2. The project issued under KYP keeps its code; the next one the
      //    unit opens takes TRD and continues the same run of numbers.
      const { rows: kept } = await client.query<{ code: string }>(
        "select code from ecapital.project where id = '00000000-0000-4000-8000-000000000024'",
      );
      expect(kept[0].code).toBe("KYP-2026-001");
      const { rows: next } = await client.query<{ code: string }>(
        "select ecapital.allocate_project_code('troodos', 2026) as code",
      );
      expect(next[0].code).toBe("TRD-2026-002");

      // 3. Idempotent: a second run changes no row and writes no audit row.
      const { rows: auditBefore } = await client.query<{ n: string }>(
        "select count(*)::text as n from ecapital.audit_log where entity_type = 'org_unit'",
      );
      await client.query(zeroZeroTwoFour!.sql);
      const { rows: auditAfter } = await client.query<{ n: string }>(
        "select count(*)::text as n from ecapital.audit_log where entity_type = 'org_unit'",
      );
      expect(auditAfter[0].n).toBe(auditBefore[0].n);
    } finally {
      await client.end();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${legacyDb}`);
      await cleanup.end();
    }
  }, 180_000);

  /**
   * ADR-0035. Like 0024 this is about rows that already exist, so it runs on
   * its own database: everything up to 0024, a contract with a number typed
   * into «Παρατάσεις (ημέρες)», a role matrix with one cell the administrator
   * has set, and only then 0025 — twice.
   */
  it("0025 carries a typed extension over as one row, keeps the sum by trigger and is idempotent", async () => {
    const legacyDb = "ecapital_migration_0025_test";
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
      const upTo0024 = files.filter((m) => m.id < "0025");
      const zeroZeroTwoFive = files.find((m) => m.id === "0025_delay_extensions_claims");
      expect(zeroZeroTwoFive).toBeDefined();

      await client.query("create schema if not exists ecapital");
      for (const migration of upTo0024) await client.query(migration.sql);

      await client.query(`
        insert into ecapital.org_unit (id, code, name_el, name_en, type, directorate, entity_code, efinance_code)
        values ('larnaca-general', 'LGH', 'Γενικό Νοσοκομείο Λάρνακας', 'Larnaca General Hospital',
                'HOSPITAL', 'LARNAKAS_AMMOCHOSTOU', 'LGH', 'LGH')`);
      await client.query(`
        insert into ecapital.project (id, org_unit_id, code, title_el, category, phase, approved_budget)
        values ('00000000-0000-4000-8000-000000000025', 'larnaca-general',
                ecapital.allocate_project_code('larnaca-general', 2024), 'Ανακαίνιση χειρουργείων',
                'RENOVATION', 'IN_PROGRESS', 1000000)`);
      await client.query(`insert into ecapital.contractor (id, name) values
        ('00000000-0000-4000-8000-0000000000c1', 'Ανάδοχος μεταφοράς')`);
      await client.query(`
        insert into ecapital.contract (id, project_id, org_unit_id, contractor_id, ref, contract_no, type,
                                       award_date, original_value, current_value, completion_date,
                                       extension_days, updated_at)
        values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000025', '',
                '00000000-0000-4000-8000-0000000000c1', ecapital.allocate_contract_ref(2024), 'ΤΥ/2024/001',
                'BOQ', '2024-01-10', 900000, 900000, '2024-12-03', 30, '2025-03-14T10:00:00Z'),
               ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000025', '',
                '00000000-0000-4000-8000-0000000000c1', ecapital.allocate_contract_ref(2024), 'ΤΥ/2024/002',
                'BOQ', '2024-01-10', 100000, 100000, '2024-12-03', 0, now())`);
      // The administrator chose WRITE for the head of estates on purpose.
      await client.query(`
        update ecapital.role_permission set level = 'WRITE', updated_at = now()
         where role = 'estates_head' and area_key = 'contractRecords'`);

      await client.query(zeroZeroTwoFive!.sql);

      // 1. One carried-over row for the contract that had a number, none for the other.
      const { rows: carried } = await client.query<{
        contract_id: string; days: number; approved_at: string; approver: string;
        approver_name_el: string; contractor_culpable: boolean; org_unit_id: string;
      }>(`select contract_id, days, approved_at::text, approver, approver_name_el, contractor_culpable, org_unit_id
            from ecapital.contract_extension order by contract_id`);
      expect(carried).toEqual([
        {
          contract_id: "00000000-0000-4000-8000-0000000000a1",
          days: 30,
          approved_at: "2025-03-14",
          approver: "OTHER",
          approver_name_el: "Μεταφορά",
          contractor_culpable: false,
          org_unit_id: "larnaca-general",
        },
      ]);

      // 2. The sum is the database's: typing it changes nothing, a row moves it.
      const days = async (id: string) =>
        (await client.query<{ extension_days: number }>(
          "select extension_days from ecapital.contract where id = $1", [id])).rows[0].extension_days;
      await client.query(
        "update ecapital.contract set extension_days = 99 where id = '00000000-0000-4000-8000-0000000000a1'");
      expect(await days("00000000-0000-4000-8000-0000000000a1")).toBe(30);
      await client.query(`
        insert into ecapital.contract_extension (contract_id, org_unit_id, days, approved_at, approver,
                                                 approver_name_el, reason_el)
        values ('00000000-0000-4000-8000-0000000000a2', '', 12, '2025-01-05', 'TEAA', 'ΤΕΑΑ', 'Καιρικές συνθήκες')`);
      expect(await days("00000000-0000-4000-8000-0000000000a2")).toBe(12);
      await client.query(
        "delete from ecapital.contract_extension where contract_id = '00000000-0000-4000-8000-0000000000a2'");
      expect(await days("00000000-0000-4000-8000-0000000000a2")).toBe(0);
      await expect(
        client.query(`
          insert into ecapital.contract_extension (contract_id, org_unit_id, days, approved_at, approver,
                                                   approver_name_el, reason_el)
          values ('00000000-0000-4000-8000-0000000000a2', '', 0, '2025-01-05', 'TEAA', 'ΤΕΑΑ', 'Μηδέν')`),
      ).rejects.toThrow();

      // 3. The matrix: the admin's default cell moves to APPROVE, the
      //    administrator's own choice for the head of estates stays.
      const level = async (role: string) =>
        (await client.query<{ level: string }>(
          "select level from ecapital.role_permission where role = $1 and area_key = 'contractRecords'",
          [role])).rows[0].level;
      expect(await level("admin")).toBe("APPROVE");
      expect(await level("estates_head")).toBe("WRITE");
      expect(await level("project_engineer")).toBe("WRITE");

      // 4. Idempotent: a second run adds no row and writes no audit row.
      const count = async (sql: string) => (await client.query<{ n: string }>(sql)).rows[0].n;
      const extensionsBefore = await count("select count(*)::text as n from ecapital.contract_extension");
      const auditBefore = await count("select count(*)::text as n from ecapital.audit_log");
      await client.query(zeroZeroTwoFive!.sql);
      expect(await count("select count(*)::text as n from ecapital.contract_extension")).toBe(extensionsBefore);
      expect(await count("select count(*)::text as n from ecapital.audit_log")).toBe(auditBefore);

      // 5. Row-level security on the three new tables.
      const { rows: rls } = await client.query<{ relname: string; relrowsecurity: boolean }>(`
        select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'ecapital'
           and c.relname in ('contract_section', 'contract_extension', 'contract_claim')
         order by c.relname`);
      expect(rls).toEqual([
        { relname: "contract_claim", relrowsecurity: true },
        { relname: "contract_extension", relrowsecurity: true },
        { relname: "contract_section", relrowsecurity: true },
      ]);
    } finally {
      await client.end();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${legacyDb}`);
      await cleanup.end();
    }
  }, 180_000);

  /**
   * ADR-0036. The three enum values, the four cost_txn columns and the
   * vendor-number key on the rules, on the fully migrated database, and the
   * file run a second time by hand changing none of it.
   */
  it("0026 adds the capital lines' enum values, columns and rule key, and is idempotent", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const file = readMigrations().find((m) => m.id === "0026_sap_capital_lines");
      expect(file).toBeDefined();

      const state = async () => {
        const { rows: labels } = await client.query<{ typname: string; enumlabel: string }>(
          `select t.typname, e.enumlabel
             from pg_enum e join pg_type t on t.oid = e.enumtypid
             join pg_namespace n on n.oid = t.typnamespace
            where n.nspname = 'ecapital' and t.typname in ('sap_report', 'cost_matched_by')
            order by t.typname, e.enumsortorder`,
        );
        const { rows: columns } = await client.query<{ table_name: string; column_name: string; data_type: string }>(
          `select table_name, column_name, data_type from information_schema.columns
            where table_schema = 'ecapital'
              and ((table_name = 'cost_txn'
                    and column_name in ('vendor_no', 'contract_ref', 'invoice_ref', 'efinance_invoice_id'))
                or (table_name = 'allocation_rule' and column_name = 'vendor_no'))
            order by table_name, column_name`,
        );
        const { rows: indexes } = await client.query<{ indexname: string; indexdef: string }>(
          `select indexname, indexdef from pg_indexes
            where schemaname = 'ecapital'
              and indexname in ('allocation_rule_key', 'allocation_rule_vendor_no_key',
                                'cost_txn_vendor_no_idx', 'cost_txn_contract_ref_idx')
            order by indexname`,
        );
        return { labels, columns, indexes };
      };

      const before = await state();
      expect(before.labels.filter((l) => l.typname === "sap_report").map((l) => l.enumlabel)).toEqual([
        "ME2N",
        "KSB1",
        "FBL1N",
        "CAPEX_LINES",
      ]);
      expect(before.labels.filter((l) => l.typname === "cost_matched_by").map((l) => l.enumlabel)).toEqual([
        "WBS",
        "PO",
        "COST_CENTRE",
        "MANUAL",
        "RULE",
        "NONE",
        "CONTRACT_REF",
        "EFINANCE_INVOICE",
      ]);
      expect(before.columns.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
        "allocation_rule.vendor_no",
        "cost_txn.contract_ref",
        "cost_txn.efinance_invoice_id",
        "cost_txn.invoice_ref",
        "cost_txn.vendor_no",
      ]);
      expect(before.indexes.map((i) => i.indexname)).toEqual([
        "allocation_rule_key",
        "allocation_rule_vendor_no_key",
        "cost_txn_contract_ref_idx",
        "cost_txn_vendor_no_idx",
      ]);
      expect(before.indexes.find((i) => i.indexname === "allocation_rule_key")?.indexdef).toContain(
        "WHERE (vendor_no IS NULL)",
      );

      await client.query(file!.sql);
      expect(await state()).toEqual(before);
    } finally {
      await client.end();
    }
  });

  /**
   * ADR-0037. The plan table: row-level security, the audit trigger, the two
   * checks a script cannot get past, and the file run a second time by hand
   * changing nothing.
   */
  it("0028 adds the cash-flow plan with its policies, its checks and its trail, and is idempotent", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const file = readMigrations().find((m) => m.id === "0028_project_cashflow_plan");
      expect(file).toBeDefined();
      const state = async () => {
        const { rows: policies } = await client.query<{ policyname: string }>(
          `select policyname from pg_policies
            where schemaname = 'ecapital'
              and (tablename = 'project_cashflow_plan' or policyname = 'audit_log_read_cashflow_plan')
            order by policyname`,
        );
        const { rows: triggers } = await client.query<{ tgname: string }>(
          `select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
            where c.relname = 'project_cashflow_plan' and not t.tgisinternal order by t.tgname`,
        );
        const { rows: checks } = await client.query<{ conname: string }>(
          `select conname from pg_constraint where conrelid = 'ecapital.project_cashflow_plan'::regclass
            order by conname`,
        );
        return { policies, triggers, checks };
      };
      const before = await state();
      expect(before.policies.map((p) => p.policyname)).toEqual([
        "audit_log_read_cashflow_plan",
        "project_cashflow_plan_read",
        "project_cashflow_plan_write",
      ]);
      expect(before.triggers.map((t) => t.tgname)).toEqual([
        "project_cashflow_plan_audit",
        "project_cashflow_plan_inherit_org_unit",
      ]);
      expect(before.checks.map((c) => c.conname)).toEqual(
        expect.arrayContaining([
          "project_cashflow_plan_amount_nonnegative",
          "project_cashflow_plan_period_key",
          "project_cashflow_plan_period_month",
        ]),
      );
      await client.query(file!.sql);
      expect(await state()).toEqual(before);
    } finally {
      await client.end();
    }
  });

  /**
   * 0029: a claim's papers are `document` rows of three new kinds, queued
   * under their own module. No policy moves in 0029. 0030 comes after it on
   * this database: it adds the RFI evidence kind, the `rfi_document` module
   * (keeping `claim_document`) and the one narrow `document_insert_rfi`
   * policy, so the replay is 0029 then 0030, as a fresh install runs them.
   * 0034 (owner request 26/11/2026) does the same for a site instruction's
   * correspondence, keeping every module before it, so it closes the replay.
   */
  it("0029 adds the claim paper kinds and module, touches no policy, and is idempotent", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const files = readMigrations();
      const file = files.find((m) => m.id === "0029_claim_documents");
      const next = files.find((m) => m.id === "0030_rfi_recipient_and_sap_asset_class");
      const last = files.find((m) => m.id === "0034_site_instruction_mail");
      expect(file).toBeDefined();
      expect(next).toBeDefined();
      expect(last).toBeDefined();

      const state = async () => {
        const { rows: labels } = await client.query<{ enumlabel: string }>(
          `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
             join pg_namespace n on n.oid = t.typnamespace
            where n.nspname = 'ecapital' and t.typname = 'document_kind'
            order by e.enumsortorder`,
        );
        const { rows: check } = await client.query<{ def: string }>(
          `select pg_get_constraintdef(c.oid) as def from pg_constraint c
            where c.conname = 'dms_outbox_module_known'`,
        );
        const { rows: policies } = await client.query<{ policyname: string }>(
          `select policyname from pg_policies
            where schemaname = 'ecapital' and tablename = 'document' order by policyname`,
        );
        return { labels: labels.map((l) => l.enumlabel), check: check[0]?.def ?? "", policies };
      };

      const before = await state();
      expect(before.labels.slice(-5)).toEqual([
        "CLAIM_LETTER",
        "CLAIM_REPLY",
        "CLAIM_LEGAL_LETTER",
        "RFI_EVIDENCE",
        "SITE_INSTRUCTION_EVIDENCE",
      ]);
      expect(before.check).toContain("claim_document");
      expect(before.check).toContain("rfi_document");
      expect(before.check).toContain("site_instruction_document");
      expect(before.check).toContain("work_order_document");
      expect(before.policies.map((p) => p.policyname)).toEqual([
        "document_insert_rfi",
        "document_insert_site_instruction",
        "document_insert_work_order",
        "document_read",
        "document_write",
      ]);

      await client.query(file!.sql);
      await client.query(next!.sql);
      await client.query(last!.sql);
      expect(await state()).toEqual(before);
    } finally {
      await client.end();
    }
  });

  /**
   * ADR-0038, 0031. A register written before VAT: every contract, variation
   * and certificate is taken as NET at 19 %, the gross commitment rises by
   * 19 %, eFinance's booked lines (posted net) become gross from the line's
   * own rate, and a second run changes nothing and writes no audit row.
   */
  it("0031 takes existing amounts as net at 19 %, makes eFinance's lines gross, and is idempotent", async () => {
    const legacyDb = "ecapital_migration_0031_test";
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
      const before0031 = files.filter((m) => m.id < "0031");
      const vat = files.find((m) => m.id === "0031_vat");
      expect(vat).toBeDefined();

      await client.query("create schema if not exists ecapital");
      for (const migration of before0031) await client.query(migration.sql);

      const C = "00000000-0000-4000-8000-0000000031c1";
      const P = "00000000-0000-4000-8000-000000003101";
      await client.query(`
        insert into ecapital.org_unit (id, code, name_el, name_en, type, directorate, entity_code, efinance_code)
        values ('larnaca-general', 'LGH', 'Γενικό Νοσοκομείο Λάρνακας', 'Larnaca General Hospital',
                'HOSPITAL', 'LARNAKAS_AMMOCHOSTOU', 'LGH', 'LGH')`);
      await client.query(`
        insert into ecapital.app_user (id, subject, name, email) values
          ('00000000-0000-4000-8000-0000000031a1', 'raiser', 'Μηχανικός', 'raiser@example.test'),
          ('00000000-0000-4000-8000-0000000031a2', 'approver', 'Προϊστάμενος', 'approver@example.test')`);
      await client.query(`
        insert into ecapital.project (id, org_unit_id, code, title_el, category, phase, approved_budget)
        values ('${P}', 'larnaca-general', ecapital.allocate_project_code('larnaca-general', 2026),
                'Ανακαίνιση πτέρυγας', 'RENOVATION', 'IN_PROGRESS', 1500000)`);
      await client.query(`insert into ecapital.contractor (id, name) values
        ('00000000-0000-4000-8000-0000000031b1', 'Ανάδοχος ΦΠΑ')`);
      await client.query(`
        insert into ecapital.contract (id, project_id, org_unit_id, contractor_id, ref, contract_no, type,
                                       award_date, original_value, current_value)
        values ('${C}', '${P}', '', '00000000-0000-4000-8000-0000000031b1',
                ecapital.allocate_contract_ref(2026), 'ΤΥ/2026/031', 'BOQ', '2026-01-10', 100000, 100000)`);
      await client.query(`
        insert into ecapital.variation (contract_id, org_unit_id, number, description_el, reason, value, status,
                                        raised_by, decided_by, decided_at)
        values ('${C}', '', 1, 'Πρόσθετες εργασίες', 'CLIENT_CHANGE', 10000, 'APPROVED',
                '00000000-0000-4000-8000-0000000031a1', '00000000-0000-4000-8000-0000000031a2', now()),
               ('${C}', '', 2, 'Υπό εξέταση', 'SITE_CONDITION', 5000, 'SUBMITTED',
                '00000000-0000-4000-8000-0000000031a1', null, null)`);
      await client.query(`
        insert into ecapital.payment_cert (contract_id, org_unit_id, number, period_from, period_to,
                                           work_done_value, net_payable, created_by)
        values ('${C}', '', 1, '2026-02-01', '2026-02-28', 20000, 19000, '00000000-0000-4000-8000-0000000031a1')`);
      await client.query(`
        insert into ecapital.efinance_invoice (id, org_unit_id, contract_id, currency, net, vat, gross, ledger,
                                               updated_at, raw)
        values ('9031', 'larnaca-general', '${C}', 'EUR', 3000, 570, 3570, 'booked', now(), '{}')`);
      await client.query(`
        insert into ecapital.efinance_invoice_line (invoice_id, line_no, line_total, vat_rate)
        values ('9031', 0, 1000, 19.00), ('9031', 1, 2000, 19), ('9031', 2, 500, null)`);
      await client.query(`
        insert into ecapital.cost_txn (org_unit_id, project_id, contract_id, txn_type, source, source_ref,
                                       posting_date, amount, matched_by)
        values ('larnaca-general', '${P}', '${C}', 'ACTUAL', 'EFINANCE', 'efinance:invoice:9031:0', '2026-03-01', 1000, 'RULE'),
               ('larnaca-general', '${P}', '${C}', 'ACTUAL', 'EFINANCE', 'efinance:invoice:9031:1', '2026-03-01', 2000, 'RULE'),
               ('larnaca-general', '${P}', '${C}', 'ACTUAL', 'EFINANCE', 'efinance:invoice:9031:2', '2026-03-01', 500, 'RULE'),
               ('larnaca-general', '${P}', '${C}', 'ACTUAL', 'SAP_EXTRACT', 'SAP:1', '2026-03-01', 4000, 'PO')`);

      await client.query(vat!.sql);

      // 1. The contract: net unchanged, 19 %, gross = net × 1,19; the
      //    commitment is the original plus the APPROVED variation, gross.
      const { rows: [contract] } = await client.query(`
        select vat_rate::text, original_value::text, original_vat::text, original_gross::text,
               current_value::text, current_gross::text
          from ecapital.contract where id = '${C}'`);
      expect(contract).toEqual({
        vat_rate: "STANDARD_19",
        original_value: "100000.00",
        original_vat: "19000.00",
        original_gross: "119000.00",
        current_value: "110000.00",
        current_gross: "130900.00",
      });

      // 2. Variations and the certificate: 19 %, VAT and gross generated.
      const { rows: variations } = await client.query(`
        select number, vat_rate::text, vat_amount::text, gross_value::text
          from ecapital.variation where contract_id = '${C}' order by number`);
      expect(variations).toEqual([
        { number: 1, vat_rate: "STANDARD_19", vat_amount: "1900.00", gross_value: "11900.00" },
        { number: 2, vat_rate: "STANDARD_19", vat_amount: "950.00", gross_value: "5950.00" },
      ]);
      const { rows: [cert] } = await client.query(`
        select vat_rate::text, vat_amount::text, gross_payable::text from ecapital.payment_cert where contract_id = '${C}'`);
      expect(cert).toEqual({ vat_rate: "STANDARD_19", vat_amount: "3610.00", gross_payable: "22610.00" });

      // 3. eFinance's lines are gross from their own rate; a line with no
      //    rate and a SAP line stay as posted (taken as gross).
      const { rows: txns } = await client.query(`
        select source_ref, amount::text, net_amount::text, vat_amount::text
          from ecapital.cost_txn where contract_id = '${C}' order by source_ref`);
      expect(txns).toEqual([
        { source_ref: "SAP:1", amount: "4000.00", net_amount: null, vat_amount: null },
        { source_ref: "efinance:invoice:9031:0", amount: "1190.00", net_amount: "1000.00", vat_amount: "190.00" },
        { source_ref: "efinance:invoice:9031:1", amount: "2380.00", net_amount: "2000.00", vat_amount: "380.00" },
        { source_ref: "efinance:invoice:9031:2", amount: "500.00", net_amount: null, vat_amount: null },
      ]);

      // 4. Idempotent: a second run changes no figure and writes no audit row.
      const snapshot = async () =>
        (await client.query(`
          select (select json_agg(c order by c.id) from (select id, vat_rate, current_gross from ecapital.contract) c)::text as c,
                 (select json_agg(t order by t.source_ref) from (select source_ref, amount, net_amount from ecapital.cost_txn) t)::text as t,
                 (select count(*) from ecapital.audit_log)::text as audit`)).rows[0];
      const first = await snapshot();
      await client.query(vat!.sql);
      expect(await snapshot()).toEqual(first);

      // 5. A new variation and certificate take the contract's rate; the
      //    rate moves the gross and the gross commitment follows.
      await client.query(`update ecapital.contract set vat_rate = 'REDUCED_5' where id = '${C}'`);
      const { rows: [moved] } = await client.query(
        `select original_gross::text, current_gross::text from ecapital.contract where id = '${C}'`);
      // 105.000 + the approved variation at its own 19 %: 11.900.
      expect(moved).toEqual({ original_gross: "105000.00", current_gross: "116900.00" });
      await client.query(`
        insert into ecapital.variation (contract_id, org_unit_id, number, description_el, reason, value, raised_by)
        values ('${C}', '', 3, 'Νέα', 'OTHER', 1000, '00000000-0000-4000-8000-0000000031a1')`);
      const { rows: [inherited] } = await client.query(
        `select vat_rate::text, gross_value::text from ecapital.variation where contract_id = '${C}' and number = 3`);
      expect(inherited).toEqual({ vat_rate: "REDUCED_5", gross_value: "1050.00" });
      await client.query(`
        update ecapital.variation set status = 'APPROVED', decided_by = '00000000-0000-4000-8000-0000000031a2',
               decided_at = now() where contract_id = '${C}' and number = 3`);
      const { rows: [approved] } = await client.query(
        `select current_value::text, current_gross::text from ecapital.contract where id = '${C}'`);
      expect(approved).toEqual({ current_value: "111000.00", current_gross: "117950.00" });

      // 6. No policy is added or dropped on the four tables (RLS unchanged).
      const { rows: rls } = await client.query<{ relname: string; relrowsecurity: boolean }>(`
        select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'ecapital' and c.relname in ('contract', 'variation', 'payment_cert', 'cost_txn')
         order by c.relname`);
      expect(rls.every((r) => r.relrowsecurity)).toBe(true);
    } finally {
      await client.end();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${legacyDb}`);
      await cleanup.end();
    }
  }, 180_000);

  /**
   * Owner UAT 25/11/2026, 0032. An RFI closed under 0006's rule gets its
   * closed_at from updated_at; an existing contractor gets an empty MANUAL
   * contact; a second run changes nothing and writes no audit row.
   */
  it("0032 backfills the close of an old closed RFI, gives contractors an empty contact, and is idempotent", async () => {
    const legacyDb = "ecapital_migration_0032_test";
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
      const before0032 = files.filter((m) => m.id < "0032");
      const close = files.find((m) => m.id === "0032_rfi_close_and_contractor_contact");
      expect(close).toBeDefined();

      await client.query("create schema if not exists ecapital");
      for (const migration of before0032) await client.query(migration.sql);

      const U = "00000000-0000-4000-8000-0000000032a1";
      const P = "00000000-0000-4000-8000-000000003201";
      const K = "00000000-0000-4000-8000-0000000032b1";
      const C = "00000000-0000-4000-8000-0000000032c1";
      await client.query(`
        insert into ecapital.org_unit (id, code, name_el, name_en, type, directorate, entity_code, efinance_code)
        values ('larnaca-general', 'LGH', 'Γενικό Νοσοκομείο Λάρνακας', 'Larnaca General Hospital',
                'HOSPITAL', 'LARNAKAS_AMMOCHOSTOU', 'LGH', 'LGH')`);
      await client.query(`insert into ecapital.app_user (id, subject, name, email)
        values ('${U}', 'engineer', 'Μηχανικός', 'engineer@example.test')`);
      await client.query(`
        insert into ecapital.project (id, org_unit_id, code, title_el, category, phase, approved_budget)
        values ('${P}', 'larnaca-general', ecapital.allocate_project_code('larnaca-general', 2026),
                'Ανακαίνιση', 'RENOVATION', 'IN_PROGRESS', 100000)`);
      await client.query(`insert into ecapital.contractor (id, name, sap_vendor_id) values ('${K}', 'Ανάδοχος επαφής', '100123')`);
      await client.query(`
        insert into ecapital.contract (id, project_id, org_unit_id, contractor_id, ref, contract_no, type,
                                       award_date, original_value, current_value)
        values ('${C}', '${P}', '', '${K}', ecapital.allocate_contract_ref(2026), 'ΤΥ/2026/032', 'BOQ',
                '2026-01-10', 1000, 1000)`);
      await client.query(`
        insert into ecapital.rfi (contract_id, org_unit_id, number, question_el, answer_el, raised_by, raised_at,
                                  answered_by, answered_at, sla_due_at, sla_hours, status, updated_at)
        values ('${C}', '', 1, 'Παλιά ερώτηση', 'Παλιά απάντηση', '${U}', '2026-03-01T08:00:00Z',
                '${U}', '2026-03-02T08:00:00Z', '2026-03-08T08:00:00Z', 168, 'CLOSED', '2026-03-03T09:00:00Z'),
               ('${C}', '', 2, 'Ανοιχτή ερώτηση', null, '${U}', '2026-03-01T08:00:00Z',
                null, null, '2026-03-08T08:00:00Z', 168, 'OPEN', '2026-03-01T08:00:00Z')`);

      await client.query(close!.sql);

      const { rows: rfis } = await client.query(`
        select number, closed_at, closed_by, closing_note, answered_on
          from ecapital.rfi where contract_id = '${C}' order by number`);
      expect(rfis[0].closed_at.toISOString()).toBe("2026-03-03T09:00:00.000Z");
      expect(rfis[0].closed_by).toBeNull();
      expect(rfis[0].answered_on).toBeNull();
      expect(rfis[1].closed_at).toBeNull();

      const { rows: [contractor] } = await client.query(`
        select contact_name, contact_email, contact_phone, contact_source, contact_synced_at
          from ecapital.contractor where id = '${K}'`);
      expect(contractor).toEqual({
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        contact_source: "MANUAL",
        contact_synced_at: null,
      });

      // The new rule holds on the old data: the open one closes with a note.
      await client.query(`update ecapital.rfi set status = 'CLOSED', closed_at = now(), closed_by = '${U}',
                                 closing_note = 'Δεν χρειάζεται πια.' where contract_id = '${C}' and number = 2`);

      const snapshot = async () =>
        (await client.query(`
          select (select json_agg(r order by r.number) from (select number, status, closed_at, closing_note from ecapital.rfi) r)::text as r,
                 (select count(*) from ecapital.audit_log)::text as audit`)).rows[0];
      const first = await snapshot();
      await client.query(close!.sql);
      expect(await snapshot()).toEqual(first);
    } finally {
      await client.end();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${legacyDb}`);
      await cleanup.end();
    }
  }, 180_000);

  /**
   * ADR-0039, 0033. On a database at 0032 with an administrator's own choice
   * in the matrix: the enum and both CHECK constraints take the new role and
   * area, the defaults are seeded without touching that choice, the new
   * value is usable once the file has committed, and a second run changes
   * nothing and writes no audit row.
   */
  it("0033 adds the technical approver to a database at 0032, keeps the administrator's choices, and is idempotent", async () => {
    const legacyDb = "ecapital_migration_0033_test";
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
      const before0033 = files.filter((m) => m.id < "0033");
      const technical = files.find((m) => m.id === "0033_technical_approver_role");
      expect(technical).toBeDefined();

      await client.query("create schema if not exists ecapital");
      for (const migration of before0033) await client.query(migration.sql);

      // An administrator's change, made before 0033: it must survive.
      await client.query(`update ecapital.role_permission set level = 'READ', updated_at = now()
                           where role = 'estates_head' and area_key = 'permitRequest'`);
      const before = await client.query<{ count: string }>("select count(*) from ecapital.role_permission");
      expect(Number(before.rows[0].count)).toBe(8 * 36);

      // As the runner applies it: one transaction for the whole file.
      await client.query("begin");
      await client.query(technical!.sql);
      await client.query("commit");

      const { rows: cells } = await client.query<{
        role: string;
        area_key: string;
        level: string;
        updated_at: Date | null;
      }>("select role, area_key, level, updated_at from ecapital.role_permission");
      expect(cells).toHaveLength(9 * 37);
      const cell = (role: string, area: string) => cells.find((c) => c.role === role && c.area_key === area);
      expect(cell("estates_head", "permitRequest")?.level).toBe("READ");
      expect(cell("technical_approver", "permitTechnical")?.level).toBe("APPROVE");
      expect(cell("estates_head", "permitTechnical")?.level).toBe("APPROVE");
      expect(cell("admin", "permitTechnical")?.level).toBe("APPROVE");
      expect(cell("clinical_approver", "permitTechnical")?.level).toBe("READ");
      expect(cell("technical_approver", "permitClinical")?.level).toBe("READ");
      expect(cell("technical_approver", "workOrderRaise")?.level).toBe("WRITE");
      expect(cell("technical_approver", "permitTechnical")?.updated_at).toBeNull();

      // The value is usable once committed, and the checks refuse the unknown.
      const U = "00000000-0000-4000-8000-0000000033a1";
      await client.query(`insert into ecapital.app_user (id, subject, name, email)
        values ('${U}', 'technical', 'Τεχνικός εγκρίνων', 'technical@example.test')`);
      await client.query(
        `insert into ecapital.app_user_role (app_user_id, role) values ('${U}', 'technical_approver')`,
      );
      await expect(
        client.query(
          `insert into ecapital.role_permission (role, area_key, level) values ('nobody', 'portfolio', 'READ')`,
        ),
      ).rejects.toThrow(/role_permission_role_known/);
      await expect(
        client.query(
          `insert into ecapital.role_permission (role, area_key, level) values ('admin', 'nowhere', 'READ')`,
        ),
      ).rejects.toThrow(/role_permission_area_known/);

      const snapshot = async () =>
        (
          await client.query(`
          select (select json_agg(r order by r.role, r.area_key)
                    from (select role, area_key, level from ecapital.role_permission) r)::text as r,
                 (select count(*) from ecapital.audit_log)::text as audit`)
        ).rows[0];
      const first = await snapshot();
      await client.query("begin");
      await client.query(technical!.sql);
      await client.query("commit");
      expect(await snapshot()).toEqual(first);
    } finally {
      await client.end();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${legacyDb}`);
      await cleanup.end();
    }
  }, 180_000);

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
    // R09 as the owner changed it (UAT 25/11/2026, 0032): an RFI closes with
    // an answer or with a closing note, and 0006's «answered first» is gone.
    expect(names).toContain("rfi_closed_answer_or_note");
    expect(names).toContain("rfi_answered_on_not_before_raised");
    expect(names).not.toContain("rfi_answered_before_closed");
    // R09: only a cost-impact instruction turns into a variation.
    expect(names).toContain("site_instruction_variation_needs_cost_impact");
    // Owner request 26/11/2026 (0034): an instruction is sent no earlier than
    // it was issued, to a name and an address of a sane shape.
    expect(names).toContain("site_instruction_sent_not_before_issued");
    expect(names).toContain("site_instruction_recipient_name_length");
    expect(names).toContain("site_instruction_recipient_email_shape");
    // R35: funded means a capital project is paying for it.
    expect(names).toContain("defect_funded_needs_project");
  });

  /**
   * Owner request 26/11/2026, 0034. A second run changes nothing: the three
   * columns, the evidence kind, the one insert policy and the module list
   * are the same afterwards, and the module list still names every module
   * before it.
   */
  it("0034 gives site instructions a recipient, a sent day and their own evidence, and is idempotent", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const file = readMigrations().find((m) => m.id === "0034_site_instruction_mail");
      expect(file).toBeDefined();
      const state = async () => {
        const { rows: columns } = await client.query<{ column_name: string; is_nullable: string }>(
          `select column_name, is_nullable from information_schema.columns
            where table_schema = 'ecapital' and table_name = 'site_instruction'
              and column_name in ('recipient_name', 'recipient_email', 'sent_on') order by column_name`,
        );
        const { rows: check } = await client.query<{ def: string }>(
          `select pg_get_constraintdef(c.oid) as def from pg_constraint c
            where c.conname = 'dms_outbox_module_known'`,
        );
        const { rows: policy } = await client.query<{ cmd: string; with_check: string }>(
          `select cmd, with_check from pg_policies where schemaname = 'ecapital'
              and tablename = 'document' and policyname = 'document_insert_site_instruction'`,
        );
        return { columns, check: check[0]?.def ?? "", policy };
      };
      const before = await state();
      expect(before.columns).toEqual([
        { column_name: "recipient_email", is_nullable: "YES" },
        { column_name: "recipient_name", is_nullable: "YES" },
        { column_name: "sent_on", is_nullable: "YES" },
      ]);
      for (const module of [
        "award",
        "business_case",
        "variation",
        "permit",
        "payment_cert",
        "asset_document",
        "work_order_document",
        "claim_document",
        "rfi_document",
        "site_instruction_document",
      ]) {
        expect(before.check).toContain(`'${module}'`);
      }
      expect(before.policy).toHaveLength(1);
      expect(before.policy[0].cmd).toBe("INSERT");
      expect(before.policy[0].with_check).toContain("can_manage_site_log");

      await client.query(file!.sql);
      expect(await state()).toEqual(before);
    } finally {
      await client.end();
    }
  });

  /**
   * Owner decision 26/11/2026, 0035: the permit handback in two steps. Five
   * nullable columns, two CHECKs, the breach sweep that skips a waiting
   * handback, §9's read rule with its one narrow clause, and no policy on the
   * permit table moves. A second run changes nothing.
   */
  it("0035 records the permit handback, keeps the sweep off it, moves no policy, and is idempotent", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const file = readMigrations().find((m) => m.id === "0035_permit_handback");
      expect(file).toBeDefined();
      const state = async () => {
        const { rows: columns } = await client.query<{ column_name: string; is_nullable: string }>(
          `select column_name, is_nullable from information_schema.columns
            where table_schema = 'ecapital' and table_name = 'shutdown_permit'
              and column_name like 'closeout_%' order by column_name`,
        );
        const { rows: checks } = await client.query<{ conname: string }>(
          `select conname from pg_constraint
            where conname in ('permit_handback_complete', 'permit_handback_return_complete')
            order by conname`,
        );
        const { rows: fn } = await client.query<{ src: string }>(
          `select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'ecapital' and p.proname = 'flip_overrun_permits'`,
        );
        const { rows: policies } = await client.query<{ policyname: string; qual: string | null }>(
          `select policyname, qual from pg_policies
            where schemaname = 'ecapital' and tablename = 'shutdown_permit' order by policyname`,
        );
        const { rows: visible } = await client.query<{ src: string }>(
          `select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'ecapital' and p.proname = 'permit_visible_to_clinician'`,
        );
        return { columns, checks, src: fn[0]?.src ?? "", visible: visible[0]?.src ?? "", policies };
      };
      const before = await state();
      expect(before.columns).toEqual([
        { column_name: "closeout_return_comment_el", is_nullable: "YES" },
        { column_name: "closeout_returned_at", is_nullable: "YES" },
        { column_name: "closeout_returned_by", is_nullable: "YES" },
        { column_name: "closeout_submitted_at", is_nullable: "YES" },
        { column_name: "closeout_submitted_by", is_nullable: "YES" },
      ]);
      expect(before.checks.map((c) => c.conname)).toEqual([
        "permit_handback_complete",
        "permit_handback_return_complete",
      ]);
      expect(before.src).toContain("closeout_submitted_at is null");
      // The one read widening: the unit-wide acceptance capacity, for the handback only.
      expect(before.visible).toContain("permit_approval");
      expect(before.visible).toContain("area_clinical_owner");
      expect(before.visible).toContain("closeout_submitted_at is not null");
      expect(before.visible).toContain("'NURSING', 'INFECTION_CONTROL'");
      expect(before.policies.map((p) => p.policyname)).toEqual([
        "shutdown_permit_delete",
        "shutdown_permit_insert",
        "shutdown_permit_read",
        "shutdown_permit_update",
      ]);
      expect(before.policies.find((p) => p.policyname === "shutdown_permit_update")?.qual).toContain(
        "permit_actionable_by",
      );

      await client.query(file!.sql);
      expect(await state()).toEqual(before);
    } finally {
      await client.end();
    }
  });

  /**
   * Owner decision 26/11/2026, 0036: one narrow function that says which
   * people are active and hold one of the given roles, for the routing and
   * the handback acceptance. No policy and no grant moves. A second run
   * changes nothing.
   */
  it("0036 adds the approver eligibility function, moves no policy, and is idempotent", async () => {
    const client = new Client({ connectionString: targetUrl });
    await client.connect();
    try {
      const file = readMigrations().find((m) => m.id === "0036_approver_eligibility");
      expect(file).toBeDefined();
      const state = async () => {
        const { rows: fn } = await client.query<{ src: string; definer: boolean }>(
          `select prosrc as src, prosecdef as definer from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'ecapital' and p.proname = 'eligible_approvers'`,
        );
        const { rows: policies } = await client.query<{ tablename: string; policyname: string }>(
          `select tablename, policyname from pg_policies
            where schemaname = 'ecapital'
              and tablename in ('app_user', 'app_user_role', 'unit_approver', 'area_clinical_owner', 'permit_approval')
            order by tablename, policyname`,
        );
        return { fn, policies };
      };
      const before = await state();
      expect(before.fn).toHaveLength(1);
      expect(before.fn[0].definer).toBe(true);
      expect(before.fn[0].src).toContain("current_actor_id() is not null");
      expect(before.fn[0].src).toContain("u.is_active");
      expect(before.fn[0].src).toContain("can_read_unit");
      await client.query(file!.sql);
      expect(await state()).toEqual(before);
    } finally {
      await client.end();
    }
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
    // ADR-0033: the technician is no longer named; the defects row of the
    // role matrix is, and a handover defect also needs the contract row.
    expect(fn[0].src).toContain("allowed('defects', 'WRITE')");
    expect(fn[0].src).toContain("allowed('contractRecords', 'WRITE')");
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
      // 0022 (ADR-0031 §11) adds one narrow INSERT-only policy: a
      // work-order document, by whoever may work the order. 0030 adds its
      // twin for an RFI's evidence, by whoever may write the RFI log
      // (owner decision 25/11/2026), and 0034 the same for a site
      // instruction's correspondence (owner request 26/11/2026). Nothing else.
      expect(doc.map((d) => d.policyname)).toEqual([
        "document_insert_rfi",
        "document_insert_site_instruction",
        "document_insert_work_order",
        "document_read",
        "document_write",
      ]);
      expect(doc[0].with_check).toContain("'rfi'");
      expect(doc[0].with_check).toContain("RFI_EVIDENCE");
      expect(doc[0].with_check).toContain("can_manage_site_log");
      expect(doc[0].qual).toBeNull();
      expect(doc[1].with_check).toContain("'site_instruction'");
      expect(doc[1].with_check).toContain("SITE_INSTRUCTION_EVIDENCE");
      expect(doc[1].with_check).toContain("can_manage_site_log");
      expect(doc[1].qual).toBeNull();
      expect(doc[2].with_check).toContain("work_order");
      expect(doc[2].with_check).toContain("can_work_work_order");
      expect(doc[2].qual).toBeNull();
      expect(doc[3].qual).toContain("can_read_unit");
      expect(doc[4].with_check).toContain("can_manage_document");
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

  /**
   * Owner decisions of 25/11/2026. Run on its own database, the 0012 way:
   * everything before 0030, a register with one asset of every eCapital
   * class, then 0030 — twice, with a choice somebody made by hand in between.
   */
  it("0030 seeds SAP's sixteen classes, backfills the register and keeps a later choice", async () => {
    const legacyDb = "ecapital_migration_0030_test";
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
      const before = files.filter((m) => m.id < "0030");
      const zeroZeroThreeZero = files.find((m) => m.id === "0030_rfi_recipient_and_sap_asset_class");
      expect(zeroZeroThreeZero).toBeDefined();

      await client.query("create schema if not exists ecapital");
      for (const migration of before) await client.query(migration.sql);

      await client.query(`
        insert into ecapital.org_unit (id, code, name_el, name_en, type, directorate, entity_code)
        values ('nicosia-general', 'NGH', 'Γενικό Νοσοκομείο Λευκωσίας', 'Nicosia General Hospital', 'HOSPITAL', 'LEFKOSIAS', 'NGH')
        on conflict (id) do nothing`);
      const classes = [
        "BUILDING_FABRIC",
        "HVAC",
        "ELECTRICAL",
        "MEDICAL_GAS",
        "WATER",
        "FIRE",
        "LIFT",
        "BIOMEDICAL",
        "IT",
        "OTHER",
      ];
      for (const [i, assetClass] of classes.entries()) {
        await client.query(
          `insert into ecapital.asset (org_unit_id, tag, name_el, asset_class, criticality)
           values ('nicosia-general', $1, $2, $3::ecapital.asset_class, 3)`,
          [`NGH-T30-${String(i + 1).padStart(4, "0")}`, `Πάγιο ${assetClass}`, assetClass],
        );
      }

      await client.query(zeroZeroThreeZero!.sql);

      // 1. The sixteen classes, by code, with Greek and English names.
      const { rows: sap } = await client.query<{ code: string; name_el: string; active: boolean }>(
        "select code, name_el, active from ecapital.sap_asset_class order by code",
      );
      expect(sap.map((r) => r.code)).toEqual([
        "111020", "111025", "111030", "111032", "111040", "111042", "111046", "111048",
        "111050", "111052", "111054", "111056", "111058", "111062", "111066", "111120",
      ]);
      expect(sap.every((r) => r.active)).toBe(true);
      expect(sap.find((r) => r.code === "111120")?.name_el).toBe("Πάγια υπό κατασκευή");

      // 2. The backfill follows the default mapping; OTHER stays unclassed.
      const mapped = async () => {
        const { rows } = await client.query<{ asset_class: string; sap_asset_class: string | null }>(
          "select asset_class::text, sap_asset_class from ecapital.asset order by tag",
        );
        return Object.fromEntries(rows.map((r) => [r.asset_class, r.sap_asset_class]));
      };
      expect(await mapped()).toEqual({
        BUILDING_FABRIC: "111020",
        HVAC: "111042",
        ELECTRICAL: "111062",
        MEDICAL_GAS: "111062",
        WATER: "111062",
        FIRE: "111058",
        LIFT: "111040",
        BIOMEDICAL: "111030",
        IT: "111050",
        OTHER: null,
      });

      // 3. A choice made by hand survives a second run, which changes nothing.
      await client.query(
        "update ecapital.asset set sap_asset_class = '111054' where asset_class = 'IT'",
      );
      await client.query(
        "update ecapital.asset set sap_asset_class = '111025' where asset_class = 'OTHER'",
      );
      await client.query(zeroZeroThreeZero!.sql);
      const again = await mapped();
      expect(again.IT).toBe("111054");
      expect(again.OTHER).toBe("111025");
      expect(again.HVAC).toBe("111042");
      const { rows: count } = await client.query<{ n: string }>(
        "select count(*)::text as n from ecapital.sap_asset_class",
      );
      expect(Number(count[0].n)).toBe(16);

      // 4. A code that is not SAP's is refused by the foreign key.
      await expect(
        client.query("update ecapital.asset set sap_asset_class = '999999' where asset_class = 'LIFT'"),
      ).rejects.toThrow(/foreign key/);

      // 5. The RFI columns and the RFI evidence kind exist.
      const { rows: columns } = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'ecapital' and table_name = 'rfi'
            and column_name in ('recipient_name', 'recipient_email', 'sent_on') order by column_name`,
      );
      expect(columns.map((c) => c.column_name)).toEqual(["recipient_email", "recipient_name", "sent_on"]);
      const { rows: kinds } = await client.query<{ enumlabel: string }>(
        `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
          where t.typname = 'document_kind' and e.enumlabel = 'RFI_EVIDENCE'`,
      );
      expect(kinds).toHaveLength(1);

      // 6. The queue's module list keeps 0029's claim papers and adds the RFI's.
      const { rows: moduleCheck } = await client.query<{ def: string }>(
        `select pg_get_constraintdef(c.oid) as def from pg_constraint c
          where c.conname = 'dms_outbox_module_known'`,
      );
      expect(moduleCheck[0].def).toContain("'claim_document'");
      expect(moduleCheck[0].def).toContain("'rfi_document'");
      expect(moduleCheck[0].def).toContain("'work_order_document'");
    } finally {
      await client.end();
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${legacyDb}`);
      await cleanup.end();
    }
  }, 180_000);

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
