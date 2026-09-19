/**
 * The import itself: one file, one transaction, one reconciliation report.
 *
 * R41 and CAPEX-03 §9. Four things about the shape of this file are
 * deliberate and are the reason ADR-0016 exists:
 *
 *  1. **Dry run by default.** Without `--commit` the transaction is rolled
 *     back at the end and the report is produced anyway. The first thing
 *     anybody does with a new file is read what would have happened.
 *  2. **One transaction.** Every row of every table, and the audit rows the
 *     triggers write, land together or not at all. There is no half-imported
 *     register to clean up by hand.
 *  3. **Under the importing user's identity.** `app.user_id`, `app.roles` and
 *     `app.org_unit_ids` are set exactly as the API's RLS interceptor sets
 *     them (ADR-0010), so the policies and the audit trigger treat an import
 *     like any other write. An account that may not write to every unit is
 *     refused by Postgres, not by an `if` in this file.
 *  4. **The counts stop it.** If the file does not classify into the number
 *     of project and footer rows the profile expects, the run stops before
 *     the first insert (CAPEX-03 §1).
 */
import { existsSync } from "node:fs";
import { Client } from "pg";
import { I18nService } from "../common/i18n.service";
import { loadProfile } from "./profile";
import {
  allExceptions,
  countByRule,
  validate,
  type ValidationResult,
} from "./validate";
import { parseSheet, type ImportException, type OrgUnitIndex } from "./parse";
import { renderReport, type ReportException, type RunReport } from "./report";
import { key, normaliseTitle, toCents } from "./text";
import { loadWorkbook, sha256Of, type LoadedWorkbook } from "./workbook";

export interface RunOptions {
  file: string;
  profile: string;
  commit: boolean;
  asOf: string | null;
  reportPath: string | null;
  actorEmail: string | null;
  databaseUrl: string;
  /** Owner connection, used only to resolve `--as` before RLS is set. */
  migrationDatabaseUrl: string;
}

export interface RunOutcome {
  report: RunReport;
  markdown: string;
  exitCode: number;
  batchId: string | null;
}

/** Thrown for the things that stop a run before it starts. */
export class ImportError extends Error {
  constructor(
    readonly messageKey: string,
    readonly params: Record<string, string> = {},
  ) {
    super(messageKey);
  }
}

const el = new I18nService("el");

interface Actor {
  id: string;
  subject: string;
  name: string;
  email: string;
  roles: string[];
  orgUnitIds: string[];
}

interface ExistingProject {
  id: string;
  orgUnitId: string;
  titleEl: string;
  naturalKey: string;
  importBatchId: string | null;
  approvedBudget: number;
  actual: number | null;
  phase: string;
  fields: Record<string, string | null>;
}

/** CAPEX-03 §3: the alias table is what makes the next spelling a data fix. */
async function orgUnitIndex(client: Client): Promise<OrgUnitIndex> {
  const index: OrgUnitIndex = new Map();
  const units = await client.query<{
    id: string;
    code: string;
    name_el: string;
    name_en: string;
    directorate: string;
  }>("select id, code, name_el, name_en, directorate from ecapital.org_unit");
  for (const u of units.rows) {
    const ref = { id: u.id, code: u.code, nameEl: u.name_el, directorate: u.directorate };
    for (const spelling of [u.code, u.name_el, u.name_en]) index.set(key(spelling), ref);
  }
  const aliases = await client.query<{ alias: string; org_unit_id: string }>(
    "select alias, org_unit_id from ecapital.org_unit_alias",
  );
  for (const a of aliases.rows) {
    const unit = units.rows.find((u) => u.id === a.org_unit_id);
    if (!unit) continue;
    index.set(key(a.alias), {
      id: unit.id,
      code: unit.code,
      nameEl: unit.name_el,
      directorate: unit.directorate,
    });
  }
  return index;
}

async function resolveActor(url: string, email: string): Promise<Actor> {
  // Read over the owner connection, like AuthService.devTokenFor: there is no
  // identity yet, and under the policy on app_user a session without one sees
  // no users, correctly.
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string; subject: string; name: string }>(
      "select id, subject, name from ecapital.app_user where email = $1 and is_active limit 1",
      [email],
    );
    const user = rows[0];
    if (!user) throw new ImportError("import.errors.userNotFound", { email });
    const roles = await client.query<{ role: string }>(
      "select role from ecapital.app_user_role where app_user_id = $1 order by role",
      [user.id],
    );
    const units = await client.query<{ org_unit_id: string }>(
      "select org_unit_id from ecapital.app_user_org_unit where app_user_id = $1 order by org_unit_id",
      [user.id],
    );
    return {
      id: user.id,
      subject: user.subject,
      name: user.name,
      email,
      roles: roles.rows.map((r) => r.role),
      orgUnitIds: units.rows.map((u) => u.org_unit_id),
    };
  } finally {
    await client.end();
  }
}

function messageFor(exception: ImportException, locale: "el" | "en"): string {
  const params: Record<string, string> = { ...exception.params };
  if (params.expected) {
    params.expected = el.translate(`import.expected.${params.expected}`, locale);
  }
  return el.translate(exception.messageKey, locale, params);
}

function toReportException(exception: ImportException): ReportException {
  return {
    rule: exception.rule,
    severity: exception.severity,
    rowNo: exception.rowNo,
    projectTitle: exception.projectTitle,
    value: exception.value,
    messageEl: messageFor(exception, "el"),
    messageEn: messageFor(exception, "en"),
  };
}

export async function runImport(options: RunOptions): Promise<RunOutcome> {
  const { profile, path: profileFile } = loadProfile(options.profile);
  if (!existsSync(options.file)) {
    throw new ImportError("import.errors.fileMissing", { file: options.file });
  }
  if (!options.actorEmail) throw new ImportError("import.errors.noIdentity");

  const actor = await resolveActor(options.migrationDatabaseUrl, options.actorEmail);
  const asOf = options.asOf ?? profile.opening_actual.as_at;
  const sha256 = sha256Of(options.file);

  let workbook: LoadedWorkbook;
  try {
    workbook = await loadWorkbook(options.file, profile.sheet);
  } catch (error) {
    if (error instanceof Error && error.message.includes("has no sheet")) {
      throw new ImportError("import.errors.sheetMissing", {
        sheet: profile.sheet,
        sheets: (await sheetNamesOf(options.file)).join(", "),
      });
    }
    throw error;
  }

  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  let committed = false;
  let batchId: string | null = null;
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [actor.subject]);
    await client.query("select set_config('app.roles', $1, true)", [actor.roles.join(",")]);
    await client.query("select set_config('app.org_unit_ids', $1, true)", [
      actor.orgUnitIds.join(","),
    ]);
    await client.query("select set_config('app.ip', $1, true)", [""]);

    const units = await orgUnitIndex(client);
    const parsed = parseSheet(workbook, profile, units);

    // CAPEX-03 §1: "If the counts differ, stop and report rather than
    // import." Nothing has been written at this point and nothing will be.
    if (
      parsed.counts.project !== profile.expected_counts.project ||
      parsed.counts.footer !== profile.expected_counts.footer
    ) {
      await client.query("rollback");
      const report = emptyReport({
        profile: profile.profile,
        profileFile,
        sheet: profile.sheet,
        workbook,
        sha256,
        asOf,
        actor,
        counts: parsed.counts,
        expected: profile.expected_counts,
      });
      return { report, markdown: renderReport(report), exitCode: 2, batchId: null };
    }

    const validation = validate(parsed, profile);
    const projects = parsed.rows.filter((r) => r.classification === "PROJECT");

    // Read the register as it stands, before anything is written: the diff
    // against the previous import (§9) is a comparison with this.
    const existing = await readExisting(client);
    const previous = await client.query<{ id: string; imported_at: Date }>(
      `select id, imported_at from ecapital.import_batch
        where profile_id = $1 and committed order by imported_at desc limit 1`,
      [profile.profile],
    );

    const batch = await client.query<{ id: string }>(
      `insert into ecapital.import_batch
         (source, file_name, file_sha256, profile_id, period, rows_in, rows_project,
          rows_footer, rows_skipped, imported_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [
        profile.source,
        workbook.fileName,
        sha256,
        profile.profile,
        profile.period,
        parsed.counts.in,
        parsed.counts.project,
        parsed.counts.footer,
        parsed.counts.skipped,
        actor.subject,
      ],
    );
    batchId = batch.rows[0].id;

    const written = { budgetLines: 0, costTxns: 0, notes: 0 };
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let rejected = 0;
    const diffChanged: RunReport["diff"]["changed"] = [];
    const diffAdded: RunReport["diff"]["added"] = [];
    const seenKeys = new Set<string>();
    const phaseDisagreements: string[] = [];

    for (const row of projects) {
      const draft = row.project;
      if (!draft || validation.rejectedRows.has(row.rowNo)) {
        rejected += 1;
        continue;
      }
      const naturalKey = `${draft.orgUnitId}::${draft.titleNormalised}`;
      seenKeys.add(naturalKey);
      const before = existing.get(naturalKey);

      const noteEl = mergeNote(draft.noteEl, draft.inBudget2026Note);
      const fields: Record<string, string | null> = {
        title_el: draft.titleEl,
        note_el: noteEl,
        category: draft.category,
        category_source: draft.categorySource,
        approved_budget: money(draft.approvedBudget ?? 0),
        funding_source: draft.fundingSource,
        planned_start: draft.plannedStart,
        planned_finish: draft.plannedFinish,
        forecast_start: draft.forecastStart,
        forecast_finish: draft.forecastFinish,
        budget_article: draft.budgetArticle,
        commitment_flag: bool(draft.commitmentFlag),
        commitment_note: draft.commitmentNote,
        action_plan_ref: draft.actionPlanRef,
        in_budget_2026: bool(draft.inBudget2026),
        contractual_commitment: bool(draft.contractualCommitment),
        internal_audit_file: bool(draft.internalAuditFile),
        source_row_ref: draft.sourceRowRef,
        // Provenance, not content. `source_file_sha256` is deliberately NOT
        // compared: a one-cell edit gives the whole file a new hash, and
        // comparing it would report all 113 rows as changed and bury the one
        // that did. The hash of the file a row last came FROM is rewritten
        // whenever that row's data changes, which is when it means anything.
        source_row_no: String(row.rowNo),
      };

      let projectId: string;
      if (!before) {
        const year = Number(asOf.slice(0, 4));
        const code = await client.query<{ code: string }>(
          "select ecapital.allocate_project_code($1, $2) as code",
          [draft.orgUnitId, year],
        );
        const inserted = await client.query<{ id: string }>(
          `insert into ecapital.project
             (code, org_unit_id, title_el, note_el, category, phase, approved_budget,
              funding_source, planned_start, planned_finish, forecast_start, forecast_finish,
              budget_article, commitment_flag, commitment_note, action_plan_ref, in_budget_2026,
              contractual_commitment, internal_audit_file, source_row_ref, import_batch_id,
              source_file_sha256, source_row_no, category_source)
           values ($1, $2, $3, $4, $5::ecapital.project_category, $6::ecapital.project_phase, $7,
                   $8::ecapital.funding_source, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                   $19, $20, $21, $22, $23, $24)
           returning id`,
          [
            code.rows[0].code,
            draft.orgUnitId,
            fields.title_el,
            fields.note_el,
            fields.category,
            draft.phase,
            fields.approved_budget,
            fields.funding_source,
            fields.planned_start,
            fields.planned_finish,
            fields.forecast_start,
            fields.forecast_finish,
            fields.budget_article,
            draft.commitmentFlag,
            fields.commitment_note,
            fields.action_plan_ref,
            draft.inBudget2026,
            draft.contractualCommitment,
            draft.internalAuditFile,
            fields.source_row_ref,
            batchId,
            sha256,
            row.rowNo,
            fields.category_source,
          ],
        );
        projectId = inserted.rows[0].id;
        created += 1;
        diffAdded.push({
          rowNo: row.rowNo,
          title: draft.titleEl,
          unit: draft.unitSource ?? (draft.orgUnitId as string),
        });
      } else {
        projectId = before.id;
        // RULE (ADR-0014): the phase moves one step at a time, with a reason,
        // and there is no "correct the phase" edit. An import that rewrote it
        // would walk a project backwards without either. The sheet sets the
        // phase when the project is created and never afterwards; a
        // disagreement is reported instead.
        if (before.phase !== draft.phase) {
          phaseDisagreements.push(`${row.rowNo}: ${before.phase} → ${draft.phase}`);
        }
        const changedFields = Object.entries(fields).filter(
          ([column, value]) => (before.fields[column] ?? null) !== (value ?? null),
        );
        if (changedFields.length === 0) {
          unchanged += 1;
        } else {
          await client.query(
            `update ecapital.project set
               title_el = $2, note_el = $3, category = $4::ecapital.project_category,
               approved_budget = $5, funding_source = $6::ecapital.funding_source,
               planned_start = $7, planned_finish = $8, forecast_start = $9, forecast_finish = $10,
               budget_article = $11, commitment_flag = $12, commitment_note = $13,
               action_plan_ref = $14, in_budget_2026 = $15, contractual_commitment = $16,
               internal_audit_file = $17, source_row_ref = $18, import_batch_id = $19,
               source_file_sha256 = $20, source_row_no = $21, category_source = $22,
               updated_at = now()
             where id = $1`,
            [
              projectId,
              fields.title_el,
              fields.note_el,
              fields.category,
              fields.approved_budget,
              fields.funding_source,
              fields.planned_start,
              fields.planned_finish,
              fields.forecast_start,
              fields.forecast_finish,
              fields.budget_article,
              draft.commitmentFlag,
              fields.commitment_note,
              fields.action_plan_ref,
              draft.inBudget2026,
              draft.contractualCommitment,
              draft.internalAuditFile,
              fields.source_row_ref,
              batchId,
              sha256,
              row.rowNo,
              fields.category_source,
            ],
          );
          updated += 1;
        }
        // §9: amounts that moved by more than the profile's threshold.
        const threshold = toCents(profile.diff_amount_threshold_eur);
        const newBudget = draft.approvedBudget ?? 0;
        if (Math.abs(toCents(newBudget) - toCents(before.approvedBudget)) > threshold) {
          diffChanged.push({
            rowNo: row.rowNo,
            title: draft.titleEl,
            unit: draft.unitSource ?? (draft.orgUnitId as string),
            field: "approvedBudget",
            from: before.approvedBudget,
            to: newBudget,
          });
        }
        const newActual = row.openingActual ?? 0;
        const oldActual = before.actual ?? 0;
        if (Math.abs(toCents(newActual) - toCents(oldActual)) > threshold) {
          diffChanged.push({
            rowNo: row.rowNo,
            title: draft.titleEl,
            unit: draft.unitSource ?? (draft.orgUnitId as string),
            field: "actual",
            from: oldActual,
            to: newActual,
          });
        }
      }

      for (const line of row.budgetLines) {
        await client.query(
          `insert into ecapital.budget_line
             (org_unit_id, project_id, vintage_id, line_type, budget_year, amount,
              import_batch_id, source_row_no)
           values ($1, $2, $3, $4::ecapital.budget_line_type, $5, $6, $7, $8)
           on conflict (project_id, vintage_id, budget_year) where project_id is not null
           do update set amount = excluded.amount, import_batch_id = excluded.import_batch_id,
                         source_row_no = excluded.source_row_no, updated_at = now()
             where budget_line.amount is distinct from excluded.amount`,
          [
            draft.orgUnitId,
            projectId,
            line.vintageId,
            line.lineType,
            line.budgetYear,
            money(line.amount),
            batchId,
            row.rowNo,
          ],
        );
        written.budgetLines += 1;
      }

      if (row.openingActual !== null) {
        const sourceRef = `${profile.profile}:${profile.opening_actual.column}`;
        await client.query(
          `insert into ecapital.cost_txn
             (org_unit_id, project_id, txn_type, source, source_ref, doc_date, posting_date,
              amount, description, import_batch_id)
           values ($1, $2, 'ACTUAL', 'EXCEL_MIGRATION', $3, $4, $4, $5, $6, $7)
           on conflict (project_id, source, source_ref)
             where project_id is not null and source_ref is not null
           do update set amount = excluded.amount, doc_date = excluded.doc_date,
                         posting_date = excluded.posting_date,
                         import_batch_id = excluded.import_batch_id, updated_at = now()
             where cost_txn.amount is distinct from excluded.amount
                or cost_txn.doc_date is distinct from excluded.doc_date`,
          [
            draft.orgUnitId,
            projectId,
            sourceRef,
            asOf,
            money(row.openingActual),
            `${profile.profile} ${profile.opening_actual.column}${row.rowNo}`,
            batchId,
          ],
        );
        written.costTxns += 1;
      }

      if (row.technicalNote) {
        await client.query(
          `insert into ecapital.project_note
             (project_id, org_unit_id, kind, text_el, import_batch_id, source_row_no)
           values ($1, $2, 'TECHNICAL', $3, $4, $5)
           on conflict (project_id, kind) where import_batch_id is not null
           do update set text_el = excluded.text_el, import_batch_id = excluded.import_batch_id,
                         source_row_no = excluded.source_row_no, updated_at = now()
             where project_note.text_el is distinct from excluded.text_el`,
          [projectId, draft.orgUnitId, row.technicalNote, batchId, row.rowNo],
        );
        written.notes += 1;
      }
    }

    const exceptions = allExceptions(parsed, validation).map(toReportException);
    for (const e of exceptions) {
      await client.query(
        `insert into ecapital.import_exception
           (batch_id, rule, severity, row_no, project_title, value, message_el, message_en)
         values ($1, $2, $3::ecapital.import_severity, $4, $5, $6, $7, $8)`,
        [batchId, e.rule, e.severity, e.rowNo, e.projectTitle, e.value, e.messageEl, e.messageEn],
      );
    }

    const removed = [...existing.values()]
      .filter((p) => p.importBatchId !== null && !seenKeys.has(p.naturalKey))
      .map((p) => ({ title: p.titleEl, unit: p.orgUnitId }));

    const report = buildReport({
      profile,
      profileFile,
      workbook,
      sha256,
      asOf,
      actor,
      parsed,
      validation,
      counts: { created, updated, unchanged, rejected },
      written,
      diff: {
        previousBatchId: previous.rows[0]?.id ?? null,
        previousAt: previous.rows[0]?.imported_at.toISOString().slice(0, 16).replace("T", " ") ?? null,
        added: diffAdded,
        removed,
        changed: diffChanged,
      },
      exceptions,
      phaseDisagreements,
    });

    const shouldCommit = options.commit && !validation.blocked;
    report.committed = shouldCommit;

    await client.query(
      `update ecapital.import_batch
          set rows_created = $2, rows_updated = $3, rows_rejected = $4,
              report = $5::jsonb, committed = $6, updated_at = now()
        where id = $1`,
      [batchId, created, updated, rejected, JSON.stringify(report), shouldCommit],
    );

    if (shouldCommit) {
      await client.query("commit");
      committed = true;
    } else {
      await client.query("rollback");
    }

    const markdown = renderReport(report);
    const exitCode = validation.blocked ? 3 : 0;
    return { report, markdown, exitCode, batchId: committed ? batchId : null };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (isPermissionError(error)) {
      throw new ImportError("import.errors.notAllowed", { email: actor.email });
    }
    throw error;
  } finally {
    await client.end();
  }
}

function isPermissionError(error: unknown): boolean {
  // 42501 is both "permission denied" and "new row violates row-level
  // security policy": the import_batch policy is admin-only (0005), so a
  // unit-scoped account is refused by Postgres on the very first insert.
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "42501";
}

function money(value: number): string {
  return value.toFixed(2);
}

function bool(value: boolean): string {
  return value ? "true" : "false";
}

/**
 * CAPEX-03 §2 col J: «ΝΑΙ (μόνο δαπάνη 2026)» is a yes with a qualification
 * on it. The register has one free-text note per project, so the
 * qualification joins whatever the title's trailing parenthetical left there
 * rather than being dropped.
 */
function mergeNote(titleNote: string | null, budgetNote: string | null): string | null {
  const parts = [titleNote, budgetNote].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(" · ") : null;
}

async function readExisting(client: Client): Promise<Map<string, ExistingProject>> {
  const { rows } = await client.query<Record<string, unknown>>(
    `select p.id, p.org_unit_id, p.title_el, p.note_el, p.category::text as category,
            p.category_source, p.phase::text as phase, p.approved_budget,
            p.funding_source::text as funding_source, p.planned_start, p.planned_finish,
            p.forecast_start, p.forecast_finish, p.budget_article, p.commitment_flag,
            p.commitment_note, p.action_plan_ref, p.in_budget_2026, p.contractual_commitment,
            p.internal_audit_file, p.source_row_ref, p.import_batch_id, p.source_file_sha256,
            p.source_row_no,
            (select sum(c.amount) from ecapital.cost_txn c
              where c.project_id = p.id and c.txn_type = 'ACTUAL') as actual
       from ecapital.project p`,
  );
  const out = new Map<string, ExistingProject>();
  for (const r of rows) {
    const naturalKey = `${String(r.org_unit_id)}::${normaliseTitle(String(r.title_el))}`;
    out.set(naturalKey, {
      id: String(r.id),
      orgUnitId: String(r.org_unit_id),
      titleEl: String(r.title_el),
      naturalKey,
      importBatchId: r.import_batch_id === null ? null : String(r.import_batch_id),
      approvedBudget: Number(r.approved_budget),
      actual: r.actual === null ? null : Number(r.actual),
      phase: String(r.phase),
      fields: {
        title_el: str(r.title_el),
        note_el: str(r.note_el),
        category: str(r.category),
        category_source: str(r.category_source),
        approved_budget: r.approved_budget === null ? null : money(Number(r.approved_budget)),
        funding_source: str(r.funding_source),
        planned_start: iso(r.planned_start),
        planned_finish: iso(r.planned_finish),
        forecast_start: iso(r.forecast_start),
        forecast_finish: iso(r.forecast_finish),
        budget_article: str(r.budget_article),
        commitment_flag: bool(Boolean(r.commitment_flag)),
        commitment_note: str(r.commitment_note),
        action_plan_ref: str(r.action_plan_ref),
        in_budget_2026: bool(Boolean(r.in_budget_2026)),
        contractual_commitment: bool(Boolean(r.contractual_commitment)),
        internal_audit_file: bool(Boolean(r.internal_audit_file)),
        source_row_ref: str(r.source_row_ref),
        source_row_no: r.source_row_no === null ? null : String(r.source_row_no),
      },
    });
  }
  return out;
}

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function sheetNamesOf(file: string): Promise<string[]> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  return workbook.worksheets.map((w) => w.name);
}

interface BuildReportInput {
  profile: ReturnType<typeof loadProfile>["profile"];
  profileFile: string;
  workbook: LoadedWorkbook;
  sha256: string;
  asOf: string;
  actor: Actor;
  parsed: ReturnType<typeof parseSheet>;
  validation: ValidationResult;
  counts: { created: number; updated: number; unchanged: number; rejected: number };
  written: { budgetLines: number; costTxns: number; notes: number };
  diff: RunReport["diff"];
  exceptions: ReportException[];
  phaseDisagreements: string[];
}

function buildReport(input: BuildReportInput): RunReport {
  const { profile, parsed, validation } = input;
  const severityOf = new Map(input.exceptions.map((e) => [e.rule, e.severity]));
  const ruleCounts = [...countByRule(allExceptionsOf(input.exceptions))]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rule, count]) => ({
      rule,
      severity: severityOf.get(rule) ?? ("INFO" as const),
      count,
    }));

  const unmapped = new Map<string, { column: string; value: string; rows: number[] }>();
  const defaults = new Map<string, number>();
  for (const row of parsed.rows) {
    for (const u of row.unmapped) {
      const id = `${u.column}::${u.value}`;
      const seen = unmapped.get(id) ?? { column: u.column, value: u.value, rows: [] };
      seen.rows.push(row.rowNo);
      unmapped.set(id, seen);
    }
    for (const d of row.defaultsApplied) defaults.set(d, (defaults.get(d) ?? 0) + 1);
  }

  const deferred = profile.deferred_columns.map((d) => {
    const rows = parsed.rows.filter(
      (r) => r.classification === "PROJECT" && r.amounts.has(d.column),
    );
    return {
      column: d.column,
      target: d.target,
      until: d.until,
      rows: rows.length,
      sum: rows.reduce((total, r) => total + (r.amounts.get(d.column) ?? 0), 0),
    };
  });

  if (input.phaseDisagreements.length) {
    defaults.set(
      `phase (ADR-0014: ${input.phaseDisagreements.slice(0, 5).join("; ")})`,
      input.phaseDisagreements.length,
    );
  }

  return {
    profileId: profile.profile,
    profilePath: input.profileFile,
    sheet: profile.sheet,
    fileName: input.workbook.fileName,
    sha256: input.sha256,
    asOf: input.asOf,
    actor: `${input.actor.name} <${input.actor.email}>`,
    committed: false,
    blocked: validation.blocked,
    blockingRules: validation.blockingRules,
    stoppedOnCounts: false,
    expectedCounts: profile.expected_counts,
    counts: {
      in: parsed.counts.in,
      project: parsed.counts.project,
      footer: parsed.counts.footer,
      skipped: parsed.counts.skipped,
      created: input.counts.created,
      updated: input.counts.updated,
      unchanged: input.counts.unchanged,
      rejected: input.counts.rejected,
    },
    columnTotals: validation.columnTotals.map((c) => ({
      ...c,
      header: profile.columns[c.column]?.header ?? "",
    })),
    ruleCounts,
    exceptions: input.exceptions,
    diff: input.diff,
    unmapped: [...unmapped.values()],
    defaults: [...defaults].map(([what, count]) => ({ what, count })),
    deferred,
    writtenRows: input.written,
  };
}

function allExceptionsOf(exceptions: ReportException[]): ImportException[] {
  return exceptions.map((e) => ({
    rule: e.rule,
    severity: e.severity,
    rowNo: e.rowNo,
    projectTitle: e.projectTitle,
    value: e.value,
    messageKey: "",
    params: {},
  }));
}

interface EmptyReportInput {
  profile: string;
  profileFile: string;
  sheet: string;
  workbook: LoadedWorkbook;
  sha256: string;
  asOf: string;
  actor: Actor;
  counts: { in: number; project: number; footer: number; skipped: number };
  expected: { project: number; footer: number };
}

function emptyReport(input: EmptyReportInput): RunReport {
  return {
    profileId: input.profile,
    profilePath: input.profileFile,
    sheet: input.sheet,
    fileName: input.workbook.fileName,
    sha256: input.sha256,
    asOf: input.asOf,
    actor: `${input.actor.name} <${input.actor.email}>`,
    committed: false,
    blocked: true,
    blockingRules: [],
    stoppedOnCounts: true,
    expectedCounts: input.expected,
    counts: { ...input.counts, created: 0, updated: 0, unchanged: 0, rejected: 0 },
    columnTotals: [],
    ruleCounts: [],
    exceptions: [],
    diff: { previousBatchId: null, previousAt: null, added: [], removed: [], changed: [] },
    unmapped: [],
    defaults: [],
    deferred: [],
    writtenRows: { budgetLines: 0, costTxns: 0, notes: 0 },
  };
}

export { messageFor };
