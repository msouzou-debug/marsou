/**
 * The capex plan import (R41), against a real PostgreSQL (ADR-0012).
 *
 * The suite runs on its own database rather than the shared seeded one: an
 * import writes 113 projects across every unit, and every other suite counts
 * what is in the register.
 *
 * What it proves, in the order CAPEX-03 asks for it:
 *  §1  the file classifies into 113 project rows and 3 footer rows, and a
 *      file that does not classify that way stops before the first insert
 *  §5  every one of the fourteen rules fires on the row built to fire it,
 *      with the severity the spec gives it
 *  §9  the per-column totals tie to the file to the cent, the run without
 *      --commit writes nothing, --commit writes the register, a second run
 *      of the same file changes nothing, and a changed amount shows up in
 *      the diff
 *  ADR-0010, ADR-0011: the writes are audited under the importing user, and
 *      an account that may not write to every unit is refused by Postgres
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate";
import { seed } from "../src/db/seed";
import { inspect, parseArgs } from "../src/cli/import-capex";
import { ImportError, runImport, type RunOutcome } from "../src/cli/run";
import { loadProfile } from "../src/cli/profile";
import { parseSheet } from "../src/cli/parse";
import { loadWorkbook } from "../src/cli/workbook";
import { buildFixture, fixturePath, type Variant } from "./fixtures/build-capex-fixture";

const PROFILE = "capex_plan_2026_02";
const PROBE_PROFILE = fixturePath("capex_plan_probe.yaml");
const ADMIN = "admin@ecapital.test";

const FILES = {
  main: fixturePath("capex-plan-synthetic.xlsx"),
  clean: fixturePath("capex-plan-synthetic-clean.xlsx"),
  changed: fixturePath("capex-plan-synthetic-changed.xlsx"),
  moved: fixturePath("capex-plan-moved-column.xlsx"),
  probe: fixturePath("capex-plan-probe.xlsx"),
};

/** CAPEX-03 §0: the figures the import has to reproduce. */
const TOTALS: Record<string, number> = {
  O: 275_087_583,
  S: 101_113_949,
  U: 65_224_025,
  V: 62_897_204,
  W: 44_630_443,
  X: 2_616_272,
  AF: 71_591_105,
  AG: 66_004_161,
  AH: 42_672_530,
  AI: 3_970_001,
};

describe("capex plan import (R41)", () => {
  const dbName = "ecapital_import_test";
  let adminUrl: string;
  let migrationUrl: string;
  let appUrl: string;
  let db: Client;

  const run = (
    file: string,
    options: Partial<Parameters<typeof runImport>[0]> = {},
  ): Promise<RunOutcome> =>
    runImport({
      file,
      profile: PROFILE,
      commit: false,
      asOf: null,
      reportPath: null,
      actorEmail: ADMIN,
      databaseUrl: appUrl,
      migrationDatabaseUrl: migrationUrl,
      ...options,
    });

  const count = async (table: string, where = "true"): Promise<number> => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from ecapital.${table} where ${where}`,
    );
    return Number(rows[0].n);
  };

  beforeAll(async () => {
    adminUrl = process.env.ECAPITAL_TEST_ADMIN_URL as string;
    migrationUrl = adminUrl.replace(/\/postgres$/, `/${dbName}`);
    appUrl = `postgres://ecapital_app@127.0.0.1:${process.env.PGPORT}/${dbName}`;

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.query(`create database ${dbName}`);
    await admin.end();

    await runMigrations(migrationUrl);
    await seed(migrationUrl);

    db = new Client({ connectionString: migrationUrl });
    await db.connect();
  }, 180_000);

  afterAll(async () => {
    await db?.end();
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${dbName}`);
    await admin.end();
  });

  // --------------------------------------------------------------- §1 --

  it("classifies the sheet into 113 projects and 3 footer rows", async () => {
    const { profile } = loadProfile(PROFILE);
    const workbook = await loadWorkbook(FILES.main, profile.sheet);
    const parsed = parseSheet(workbook, profile, new Map());

    expect(parsed.counts.project).toBe(113);
    expect(parsed.counts.footer).toBe(3);
    expect(parsed.counts.skipped).toBe(7);
    // The footers are found by what is in column E, not by row number.
    const footers = parsed.rows.filter((r) => r.classification === "FOOTER");
    expect(footers.map((f) => f.titleRaw)).toEqual([
      "ΣΥΝΟΛΟ",
      "ΑΠΟΖΗΜΙΩΣΗ ΑΠΌ ΣΑΑ",
      "ΔΑΠΑΝΗ (ΝΕΤ)",
    ]);
    expect(footers.map((f) => f.rowNo)).toEqual([123, 126, 128]);
  });

  it("stops and writes nothing when the counts do not match the profile", async () => {
    const before = await count("project");
    const outcome = await run(FILES.moved, { commit: true });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.report.stoppedOnCounts).toBe(true);
    expect(outcome.report.counts.project).toBe(114);
    expect(outcome.report.counts.footer).toBe(2);
    expect(outcome.batchId).toBeNull();
    expect(await count("project")).toBe(before);
    expect(await count("import_batch")).toBe(0);
    expect(outcome.markdown).toContain("Δεν γράφτηκε τίποτα στη βάση");
  });

  it("reports the moved column and the renamed footer from `inspect`", async () => {
    const clean = await inspect(FILES.main, PROFILE);
    expect(clean).toContain("Όλες οι στήλες του προφίλ βρέθηκαν με την ίδια κεφαλίδα");
    expect(clean).toContain("Γραμμές έργων: 113");

    const moved = await inspect(FILES.moved, PROFILE);
    expect(moved).toContain("Η στήλη F του προφίλ περίμενε «ΑΡΘΡΟ» και βρήκε «ΚΩΔΙΚΟΣ SAP»");
    expect(moved).toContain("Γραμμές έργων: 114");
    expect(moved).toContain("ενημερώστε το προφίλ");
  });

  // --------------------------------------------------------------- §5 --

  it("fires V01, V02, V03, V05, V06, V08 and V09 on the February file", async () => {
    const outcome = await run(FILES.main);
    const byRule = new Map(outcome.report.ruleCounts.map((r) => [r.rule, r]));

    expect([...byRule.keys()].sort()).toEqual([
      "V01",
      "V02",
      "V03",
      "V05",
      "V06",
      "V08",
      "V09",
    ]);
    // CAPEX-03 §0 and §5, the counts the file is built to produce. V01 is
    // the one that differs from §5's "3 rows": the third row misses by €2,
    // which is inside V01's own ±€10, so the rule cannot fire on it. The
    // deviation is in the file; the tolerance is in the rule.
    expect(byRule.get("V01")).toMatchObject({ count: 2, severity: "WARN" });
    expect(byRule.get("V02")).toMatchObject({ count: 15, severity: "WARN" });
    expect(byRule.get("V03")).toMatchObject({ count: 9, severity: "INFO" });
    expect(byRule.get("V05")).toMatchObject({ count: 18, severity: "WARN" });
    expect(byRule.get("V06")).toMatchObject({ count: 6, severity: "ERROR" });
    expect(byRule.get("V08")).toMatchObject({ count: 1, severity: "WARN" });
    expect(byRule.get("V09")).toMatchObject({ count: 1, severity: "WARN" });

    // Every exception names the row, the project and the offending value.
    const v06 = outcome.report.exceptions.filter((e) => e.rule === "V06");
    expect(v06.every((e) => e.rowNo !== null && e.projectTitle && e.value)).toBe(true);
    expect(v06.some((e) => e.value === "περίπου 1,2 εκ.")).toBe(true);
    expect(v06.some((e) => e.messageEl.includes("Διορθώστε τον τύπο του κελιού"))).toBe(true);

    // V06 blocks, so the six rows it fired on are not imported.
    expect(outcome.report.counts.rejected).toBe(6);
    expect(outcome.report.blockingRules).toEqual(["V06"]);
  });

  it("fires V04, V07, V10, V11, V12, V13 and V14 on the rows built for them", async () => {
    const outcome = await run(FILES.probe, { profile: PROBE_PROFILE });
    const byRule = new Map(outcome.report.ruleCounts.map((r) => [r.rule, r]));

    expect(byRule.get("V04")).toMatchObject({ count: 1, severity: "ERROR" });
    expect(byRule.get("V07")).toMatchObject({ count: 1, severity: "ERROR" });
    expect(byRule.get("V10")).toMatchObject({ count: 1, severity: "ERROR" });
    expect(byRule.get("V11")).toMatchObject({ count: 1, severity: "ERROR" });
    expect(byRule.get("V12")).toMatchObject({ count: 1, severity: "ERROR" });
    expect(byRule.get("V13")).toMatchObject({ count: 1, severity: "ERROR" });
    expect(byRule.get("V14")).toMatchObject({ count: 1, severity: "WARN" });

    expect(outcome.report.blockingRules).toEqual([
      "V04",
      "V07",
      "V10",
      "V11",
      "V12",
      "V13",
    ]);
    // V11 is a batch rule: it names the column and no row of its own.
    const v11 = outcome.report.exceptions.find((e) => e.rule === "V11");
    expect(v11?.projectTitle).toBeNull();
    expect(v11?.messageEl).toContain("δεν συμφωνεί με το σύνολο");
    const v04 = outcome.report.exceptions.find((e) => e.rule === "V04");
    expect(v04?.value).toBe("Γ.Ν. ΚΕΡΥΝΕΙΑΣ");
  });

  // --------------------------------------------------------------- §9 --

  it("ties every column total back to the file, to the cent", async () => {
    const outcome = await run(FILES.main);
    for (const total of outcome.report.columnTotals) {
      expect(total.ok, `column ${total.column}`).toBe(true);
      expect(total.imported).toBe(TOTALS[total.column]);
      expect(total.footer).toBe(TOTALS[total.column]);
    }
    expect(outcome.markdown).toContain("275.087.583,00 €");
    expect(outcome.markdown).not.toContain("ΔΕΝ ΣΥΜΦΩΝΕΙ");
  });

  it("writes nothing without --commit", async () => {
    const outcome = await run(FILES.clean);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.report.counts.created).toBe(113);
    expect(outcome.report.committed).toBe(false);
    expect(outcome.batchId).toBeNull();
    expect(await count("project", "import_batch_id is not null")).toBe(0);
    expect(await count("import_batch")).toBe(0);
    expect(await count("budget_line")).toBe(0);
    expect(await count("cost_txn")).toBe(0);
    expect(outcome.markdown).toContain("Εκτελέστε ξανά την ίδια εντολή με --commit");
  });

  it("refuses an account that may not write to every unit", async () => {
    await expect(
      run(FILES.clean, { commit: true, actorEmail: "estates.nicosia@ecapital.test" }),
    ).rejects.toThrow(ImportError);
    expect(await count("import_batch")).toBe(0);
    expect(await count("project", "import_batch_id is not null")).toBe(0);
  });

  it("refuses to run without --as", async () => {
    await expect(run(FILES.clean, { actorEmail: null })).rejects.toMatchObject({
      messageKey: "import.errors.noIdentity",
    });
  });

  it("writes the register with --commit", async () => {
    const outcome = await run(FILES.clean, { commit: true });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.report.committed).toBe(true);
    expect(outcome.report.counts.created).toBe(113);
    expect(outcome.report.counts.rejected).toBe(0);
    expect(outcome.batchId).not.toBeNull();

    expect(await count("project", "import_batch_id is not null")).toBe(113);
    expect(await count("budget_line")).toBe(523);
    expect(await count("cost_txn", "txn_type = 'ACTUAL' and source = 'EXCEL_MIGRATION'")).toBe(62);
    expect(await count("project_note", "kind = 'TECHNICAL'")).toBe(74);

    // The batch row carries the file it read and the counts it read (§9).
    const batch = await db.query<{
      id: string;
      file_sha256: string;
      rows_in: number;
      rows_project: number;
      rows_footer: number;
      rows_created: number;
      committed: boolean;
      imported_by: string;
      profile_id: string;
    }>("select * from ecapital.import_batch");
    expect(batch.rows).toHaveLength(1);
    expect(batch.rows[0]).toMatchObject({
      rows_in: 123,
      rows_project: 113,
      rows_footer: 3,
      rows_created: 113,
      committed: true,
      imported_by: "dev-admin",
      profile_id: PROFILE,
    });
    expect(batch.rows[0].file_sha256).toMatch(/^[0-9a-f]{64}$/);

    // CAPEX-01 §9: every record links back to the file it came from.
    const provenance = await db.query<{ n: string }>(
      `select count(*)::text as n from ecapital.project
        where import_batch_id = $1 and source_file_sha256 = $2 and source_row_no between 6 and 118`,
      [batch.rows[0].id, batch.rows[0].file_sha256],
    );
    expect(Number(provenance.rows[0].n)).toBe(113);
  });

  it("puts the money where CAPEX-03 §0 says it goes", async () => {
    const lines = await db.query<{ vintage_id: string; budget_year: number; total: string }>(
      `select vintage_id, budget_year, sum(amount)::text as total
         from ecapital.budget_line group by 1, 2 order by 1, 2`,
    );
    expect(
      Object.fromEntries(lines.rows.map((r) => [`${r.vintage_id}:${r.budget_year}`, Number(r.total)])),
    ).toEqual({
      "2025-prior:2025": TOTALS.AF,
      "2025-prior:2026": TOTALS.AG,
      "2025-prior:2027": TOTALS.AH,
      "2025-prior:9999": TOTALS.AI,
      "2026-02:2026": TOTALS.U,
      "2026-02:2027": TOTALS.V,
      "2026-02:2028": TOTALS.W,
      "2026-02:9999": TOTALS.X,
    });

    const actual = await db.query<{ total: string; doc_date: string }>(
      `select sum(amount)::text as total, min(doc_date)::text as doc_date
         from ecapital.cost_txn where source = 'EXCEL_MIGRATION'`,
    );
    expect(Number(actual.rows[0].total)).toBe(TOTALS.S);
    // §2 col S: one opening balance dated at the as-of date, not a 2026 figure.
    expect(actual.rows[0].doc_date).toBe("2026-03-31");

    // §2 col L: «ΣΑΑ» is RRF, everything else the state budget.
    const funding = await db.query<{ funding_source: string; n: string }>(
      `select funding_source::text, count(*)::text as n from ecapital.project
        where import_batch_id is not null group by 1 order by 1`,
    );
    expect(Object.fromEntries(funding.rows.map((r) => [r.funding_source, Number(r.n)]))).toEqual({
      RRF: 16,
      STATE_BUDGET: 97,
    });

    // §2 col E: the trailing «μικρές ανάγκες» parenthetical is a note, not
    // part of the title. §2 col H: the euro figure next to the ΝΑΙ is a
    // note too, never an amount.
    const note = await db.query<{ title_el: string; note_el: string }>(
      `select title_el, note_el from ecapital.project where note_el like '%μικρές ανάγκες%'`,
    );
    expect(note.rows).toHaveLength(1);
    expect(note.rows[0].title_el).toBe("Αντικατάσταση κουφωμάτων Β΄ πτέρυγας");
    expect(note.rows[0].note_el).toBe("μικρές ανάγκες 2026");

    const commitment = await db.query<{ commitment_note: string; approved_budget: string }>(
      `select commitment_note, approved_budget::text from ecapital.project
        where commitment_note is not null`,
    );
    expect(commitment.rows).toHaveLength(1);
    expect(commitment.rows[0].commitment_note).toBe("€129.5");
    expect(Number(commitment.rows[0].approved_budget)).not.toBe(129.5);
  });

  it("audits every row it wrote, under the person who ran it", async () => {
    const audit = await db.query<{ entity_type: string; n: string }>(
      `select entity_type, count(*)::text as n from ecapital.audit_log
        where actor_id = 'dev-admin' group by 1 order by 1`,
    );
    const byType = Object.fromEntries(audit.rows.map((r) => [r.entity_type, Number(r.n)]));
    expect(byType.import_batch).toBeGreaterThanOrEqual(1);
    expect(byType.project).toBe(113);
    expect(byType.budget_line).toBe(523);
    expect(byType.cost_txn).toBe(62);
    expect(byType.project_note).toBe(74);
    expect(byType.import_exception).toBeGreaterThan(0);
  });

  it("changes nothing when the same file is imported again", async () => {
    const outcome = await run(FILES.clean, { commit: true });

    expect(outcome.report.counts.created).toBe(0);
    expect(outcome.report.counts.updated).toBe(0);
    expect(outcome.report.counts.unchanged).toBe(113);
    expect(await count("project", "import_batch_id is not null")).toBe(113);
    expect(await count("budget_line")).toBe(523);
    // R42, ADR-0004: an update that changes nothing is not a change, so the
    // second run leaves no new audit rows on the register itself.
    expect(await count("audit_log", "actor_id = 'dev-admin' and entity_type = 'project'")).toBe(113);
  });

  it("lists an amount that moved by more than €1,000 in the diff", async () => {
    const outcome = await run(FILES.changed, { commit: true });

    expect(outcome.report.counts.created).toBe(0);
    expect(outcome.report.counts.updated).toBe(1);
    expect(outcome.report.counts.unchanged).toBe(112);
    expect(outcome.report.diff.previousBatchId).not.toBeNull();
    expect(outcome.report.diff.changed).toHaveLength(1);
    const change = outcome.report.diff.changed[0];
    expect(change.field).toBe("approvedBudget");
    expect((change.to as number) - (change.from as number)).toBe(48_500);
    expect(outcome.markdown).toContain("Ποσά που άλλαξαν");
    expect(outcome.markdown).toContain(change.title);
  });

  it("carries the whole report into import_batch, so it can be reprinted", async () => {
    const { rows } = await db.query<{ report: { counts: { project: number } } }>(
      "select report from ecapital.import_batch order by imported_at desc limit 1",
    );
    expect(rows[0].report.counts.project).toBe(113);
  });

  it("builds the same figures every time", async () => {
    // The .xlsx files are committed; this proves they are still what the
    // script produces. exceljs stamps the zip with the time of the run, so
    // the comparison is cell by cell rather than byte by byte.
    const dir = mkdtempSync(join(tmpdir(), "capex-fixture-"));
    const { profile } = loadProfile(PROFILE);
    for (const [variant, committed] of [
      ["main", FILES.main],
      ["clean", FILES.clean],
    ] as [Variant, string][]) {
      const fresh = await buildFixture(variant, join(dir, `${variant}.xlsx`));
      const a = parseSheet(await loadWorkbook(committed, profile.sheet), profile, new Map());
      const b = parseSheet(await loadWorkbook(fresh, profile.sheet), profile, new Map());
      expect(b.rows.map(cellSummary)).toEqual(a.rows.map(cellSummary));
    }
  }, 120_000);
});

function cellSummary(row: { rowNo: number; classification: string; amounts: Map<string, number> }): unknown {
  return { rowNo: row.rowNo, classification: row.classification, amounts: [...row.amounts] };
}

describe("the command line", () => {
  it("ignores the `--` pnpm passes through", () => {
    const args = parseArgs(["--", "--file", "a.xlsx", "--profile", "p", "--as", "x@y", "--commit"]);
    expect(args).toMatchObject({
      command: "run",
      file: "a.xlsx",
      profile: "p",
      as: "x@y",
      commit: true,
    });
  });

  it("takes `inspect` as a subcommand and defaults to `run`", () => {
    expect(parseArgs(["inspect", "--file", "a.xlsx"]).command).toBe("inspect");
    expect(parseArgs(["--file", "a.xlsx"]).command).toBe("run");
  });

  it("refuses an option it does not know rather than ignoring it", () => {
    expect(() => parseArgs(["--force"])).toThrow(/Unknown option/);
  });
});
