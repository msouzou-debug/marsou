/**
 * Row classification (CAPEX-03 §1) and the column transforms (CAPEX-03 §2).
 *
 * R41. Pure functions over cells: nothing here touches the database, so the
 * whole mapping can be tested against a fixture without one, and the run
 * command is left with nothing to do but write what this produced.
 *
 * Two rules from the spec are load-bearing and easy to lose in a refactor:
 *
 *  - Row numbers are never hardcoded. A footer is a footer because of what is
 *    in column E or because columns A–D are empty, never because it is row
 *    123 (§1). The next revision moves them.
 *  - A string-typed cell where a number or a date belongs is rejected, never
 *    coerced (§2, §5 V06). Coercing it to zero produces a reconciliation
 *    report that ties perfectly to a file that is wrong.
 */
import { cellOf, type Cell, type LoadedWorkbook, type SheetRow } from "./workbook";
import { columnIndex, type ImportProfile } from "./profile";
import { collapse, key, normaliseTitle } from "./text";

export type RowClass = "PROJECT" | "FOOTER" | "SKIPPED";
export type Severity = "ERROR" | "WARN" | "INFO";

export interface ImportException {
  rule: string;
  severity: Severity;
  rowNo: number | null;
  projectTitle: string | null;
  value: string | null;
  /** Key in apps/api/src/i18n, e.g. `import.rules.V06`. */
  messageKey: string;
  params: Record<string, string>;
}

export interface BudgetLineDraft {
  vintageId: string;
  lineType: "FORECAST" | "BUDGET";
  budgetYear: number;
  amount: number;
  column: string;
}

export interface ProjectDraft {
  orgUnitId: string | null;
  unitSource: string | null;
  directorateSource: string | null;
  titleEl: string;
  titleNormalised: string;
  noteEl: string | null;
  category: string;
  categorySource: string | null;
  phase: string;
  phaseSource: string | null;
  approvedBudget: number | null;
  fundingSource: string;
  externalFundingAmount: number | null;
  budgetArticle: string | null;
  commitmentFlag: boolean;
  commitmentNote: string | null;
  actionPlanRef: string | null;
  inBudget2026: boolean;
  inBudget2026Note: string | null;
  contractualCommitment: boolean;
  internalAuditFile: boolean;
  sourceRowRef: string | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  forecastStart: string | null;
  forecastFinish: string | null;
}

export interface ParsedRow {
  rowNo: number;
  classification: RowClass;
  titleRaw: string;
  project: ProjectDraft | null;
  budgetLines: BudgetLineDraft[];
  openingActual: number | null;
  technicalNote: string | null;
  exceptions: ImportException[];
  /** Numeric cell values by column letter, for the per-column totals (§9). */
  amounts: Map<string, number>;
  /** Defaults the profile applied because the cell was blank (§2, §4). */
  defaultsApplied: string[];
  /** Cells whose value is not in the profile's lookup for that column. */
  unmapped: { column: string; value: string }[];
}

export interface OrgUnitRef {
  id: string;
  code: string;
  nameEl: string;
  directorate: string;
}

/** alias (folded) → unit. Built from org_unit and org_unit_alias (§3). */
export type OrgUnitIndex = Map<string, OrgUnitRef>;

export interface ParseResult {
  rows: ParsedRow[];
  firstDataRow: number;
  lastDataRow: number;
  counts: { in: number; project: number; footer: number; skipped: number };
  /** The file's own footer totals per column, for V11 and the report (§9). */
  footerTotals: Map<string, number>;
  footerRowNo: number | null;
}

function exception(
  rule: string,
  severity: Severity,
  rowNo: number | null,
  title: string | null,
  value: string | null,
  params: Record<string, string> = {},
): ImportException {
  return {
    rule,
    severity,
    rowNo,
    projectTitle: title,
    value,
    messageKey: `import.rules.${rule}`,
    params,
  };
}

/** A number cell, or null. A text or date cell here is V06 (§5). */
function amountOf(
  cell: Cell,
  column: string,
  rowNo: number,
  title: string,
  out: ImportException[],
): number | null {
  if (cell.kind === "empty") return null;
  if (cell.kind === "number") return cell.number;
  out.push(
    exception("V06", "ERROR", rowNo, title, cell.raw, {
      column,
      expected: "number",
      value: cell.raw,
    }),
  );
  return null;
}

/** A date cell, or null. Text — or a bare number — here is V06 (§5). */
function dateOf(
  cell: Cell,
  column: string,
  rowNo: number,
  title: string,
  out: ImportException[],
): string | null {
  if (cell.kind === "empty") return null;
  if (cell.kind === "date") return cell.date;
  out.push(
    exception("V06", "ERROR", rowNo, title, cell.raw, {
      column,
      expected: "date",
      value: cell.raw,
    }),
  );
  return null;
}

const YES = "ναι";
const NO = "οχι";

/** «ΝΑΙ», «ΟΧΙ», blank, or a yes with something after it (§2 cols H–K, AE). */
function readFlag(cell: Cell): { flag: boolean; note: string | null } {
  if (cell.kind === "empty") return { flag: false, note: null };
  if (cell.kind === "boolean") return { flag: cell.text === "TRUE", note: null };
  const text = collapse(cell.raw);
  const folded = key(text);
  if (folded === NO) return { flag: false, note: null };
  if (folded === YES) return { flag: true, note: null };
  if (folded.startsWith(YES)) {
    // «ΝΑΙ - €129.5», «ΝΑΙ - 13.28», «ΝΑΙ (μόνο δαπάνη 2026)». Whatever comes
    // after the yes is a note, never a figure this system adds up: CAPEX-03
    // §2 col H says the euro amount there is a reference to a Council of
    // Ministers decision, not this project's cost.
    const note = text.slice(3).replace(/^[\s\-–—:·.]+/, "").replace(/^\(|\)$/g, "").trim();
    return { flag: true, note: note === "" ? null : note };
  }
  if (folded.startsWith(NO)) {
    const note = text.slice(3).replace(/^[\s\-–—:·.]+/, "").replace(/^\(|\)$/g, "").trim();
    return { flag: false, note: note === "" ? null : note };
  }
  return { flag: false, note: text };
}

/**
 * CAPEX-03 §2 col E: trim, collapse whitespace, and split a trailing
 * parenthetical into the note where it opens with one of the profile's
 * prefixes. «or similar» in the spec is `title_note_prefixes`.
 */
export function splitTitle(
  raw: string,
  prefixes: string[],
): { title: string; note: string | null } {
  const title = collapse(raw);
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(title);
  if (!match) return { title, note: null };
  const inner = collapse(match[2]);
  const folded = key(inner);
  const hit = prefixes.some((p) => folded.startsWith(key(p)));
  if (!hit || match[1].trim() === "") return { title, note: null };
  return { title: match[1].trim(), note: inner };
}

function classify(row: SheetRow, profile: ImportProfile): RowClass {
  const titleColumn = columnFor(profile, "project.title_el");
  const title = cellOf(row, titleColumn);
  if (title.kind === "empty") return "SKIPPED";
  const folded = key(title.raw);
  if (profile.footer_titles.some((t) => key(t) === folded)) return "FOOTER";
  // §1's "columns A–D all empty" read as what it means: everything the
  // profile maps to the left of the title. A column that moves takes the
  // rule with it, which is the same reason row numbers are never hardcoded.
  const before = Object.keys(profile.columns).filter(
    (c) => columnIndex(c) < columnIndex(titleColumn),
  );
  if (before.length && before.every((c) => cellOf(row, c).kind === "empty")) return "FOOTER";
  return "PROJECT";
}

/** The column a target is mapped to, e.g. `project.title_el` → `E`. */
export function columnFor(profile: ImportProfile, target: string): string {
  for (const [letter, spec] of Object.entries(profile.columns)) {
    if (spec.target === target) return letter;
  }
  throw new Error(`The profile ${profile.profile} maps nothing to ${target}.`);
}

export function parseSheet(
  workbook: LoadedWorkbook,
  profile: ImportProfile,
  units: OrgUnitIndex,
): ParseResult {
  const titleColumn = columnFor(profile, "project.title_el");
  const rows: ParsedRow[] = [];
  const footerTotals = new Map<string, number>();
  let footerRowNo: number | null = null;

  // CAPEX-03 §8 `last_data_row: auto` — stop at N consecutive blank title
  // cells, never at a row number.
  const hardStop =
    profile.last_data_row === "auto"
      ? Math.max(workbook.lastRow, profile.first_data_row) + profile.blank_run_to_stop + 1
      : profile.last_data_row;
  let blankRun = 0;
  let lastDataRow = profile.first_data_row - 1;
  const scanned: SheetRow[] = [];
  for (let rowNo = profile.first_data_row; rowNo <= hardStop; rowNo += 1) {
    const row = workbook.row(rowNo);
    if (cellOf(row, titleColumn).kind === "empty") {
      blankRun += 1;
      if (profile.last_data_row === "auto" && blankRun >= profile.blank_run_to_stop) break;
      scanned.push(row);
      continue;
    }
    blankRun = 0;
    lastDataRow = rowNo;
    scanned.push(row);
  }

  for (const row of scanned) {
    if (row.rowNo > lastDataRow) break;
    const classification = classify(row, profile);
    if (classification === "SKIPPED") {
      rows.push(emptyParsed(row.rowNo, classification));
      continue;
    }
    if (classification === "FOOTER") {
      const title = collapse(cellOf(row, titleColumn).raw);
      if (key(title) === key(profile.footer_total_row_title)) {
        footerRowNo = row.rowNo;
        for (const column of profile.footer_total_columns) {
          const cell = cellOf(row, column);
          if (cell.kind === "number") footerTotals.set(column, cell.number as number);
        }
      }
      rows.push({ ...emptyParsed(row.rowNo, classification), titleRaw: title });
      continue;
    }
    rows.push(parseProjectRow(row, profile, units, titleColumn));
  }

  const counts = {
    in: rows.length,
    project: rows.filter((r) => r.classification === "PROJECT").length,
    footer: rows.filter((r) => r.classification === "FOOTER").length,
    skipped: rows.filter((r) => r.classification === "SKIPPED").length,
  };

  return {
    rows,
    firstDataRow: profile.first_data_row,
    lastDataRow,
    counts,
    footerTotals,
    footerRowNo,
  };
}

function emptyParsed(rowNo: number, classification: RowClass): ParsedRow {
  return {
    rowNo,
    classification,
    titleRaw: "",
    project: null,
    budgetLines: [],
    openingActual: null,
    technicalNote: null,
    exceptions: [],
    amounts: new Map(),
    defaultsApplied: [],
    unmapped: [],
  };
}

function parseProjectRow(
  row: SheetRow,
  profile: ImportProfile,
  units: OrgUnitIndex,
  titleColumn: string,
): ParsedRow {
  const rowNo = row.rowNo;
  const exceptions: ImportException[] = [];
  const amounts = new Map<string, number>();
  const defaultsApplied: string[] = [];
  const unmapped: { column: string; value: string }[] = [];

  const titleCell = cellOf(row, titleColumn);
  const split = splitTitle(titleCell.raw, profile.title_note_prefixes);
  const title = split.title;

  const draft: ProjectDraft = {
    orgUnitId: null,
    unitSource: null,
    directorateSource: null,
    titleEl: title,
    titleNormalised: normaliseTitle(title),
    noteEl: split.note,
    category: profile.category_default,
    categorySource: null,
    phase: profile.phase_default,
    phaseSource: null,
    approvedBudget: null,
    fundingSource: profile.funding_default,
    externalFundingAmount: null,
    budgetArticle: null,
    commitmentFlag: false,
    commitmentNote: null,
    actionPlanRef: null,
    inBudget2026: false,
    inBudget2026Note: null,
    contractualCommitment: false,
    internalAuditFile: false,
    sourceRowRef: null,
    plannedStart: null,
    plannedFinish: null,
    forecastStart: null,
    forecastFinish: null,
  };

  const deferred = new Set(profile.deferred_columns.map((d) => d.column));
  // §8 lists the ignored columns twice — once as `ignore_columns` and once as
  // each column's own transform. Both are honoured, so a column added to
  // `ignore_columns` alone still stops being read.
  const ignored = new Set(profile.ignore_columns);
  // ADR-0024: the spellings that name an organisation outside ΟΚΥπΥ, folded
  // the same way the alias index folds its keys.
  const outOfScope = new Set(profile.units_out_of_scope.map(key));

  for (const [column, spec] of Object.entries(profile.columns)) {
    const cell = cellOf(row, column);
    if (spec.transform === "amount" && cell.kind === "number") {
      amounts.set(column, cell.number as number);
    }
    if (spec.transform === "ignore" || spec.target === "none" || ignored.has(column)) continue;
    if (deferred.has(column)) continue; // read for the log, never written

    switch (spec.target) {
      case "project.category": {
        if (cell.kind === "empty") {
          exceptions.push(
            exception("V03", "INFO", rowNo, title, null, { category: profile.category_default }),
          );
          defaultsApplied.push(`${column}=${profile.category_default}`);
          break;
        }
        draft.categorySource = collapse(cell.raw);
        const mapped = lookup(profile.category_map, cell.raw);
        if (mapped) draft.category = mapped;
        else unmapped.push({ column, value: collapse(cell.raw) });
        break;
      }
      case "project.source_row_ref":
        draft.sourceRowRef = cell.kind === "empty" ? null : collapse(cell.raw);
        break;
      case "org_unit.directorate": {
        if (cell.kind === "empty") break;
        draft.directorateSource = collapse(cell.raw);
        const mapped = lookup(profile.directorate_map, cell.raw);
        if (!mapped) unmapped.push({ column, value: collapse(cell.raw) });
        break;
      }
      case "project.org_unit_id": {
        if (cell.kind === "empty") {
          exceptions.push(exception("V04", "ERROR", rowNo, title, null, { value: "" }));
          break;
        }
        draft.unitSource = collapse(cell.raw);
        // RULE (V15, ADR-0024): a spelling the profile lists as out of scope
        // names an organisation ΟΚΥπΥ does not run, so the row is rejected
        // and no unit is resolved for it. This is checked before the lookup,
        // not after: V04's answer — "add this spelling as an alias" — is the
        // wrong instruction for a unit that must never exist here.
        if (outOfScope.has(key(cell.raw))) {
          exceptions.push(
            exception("V15", "ERROR", rowNo, title, collapse(cell.raw), {
              value: collapse(cell.raw),
            }),
          );
          break;
        }
        const unit = units.get(key(cell.raw));
        if (!unit) {
          exceptions.push(
            exception("V04", "ERROR", rowNo, title, collapse(cell.raw), {
              value: collapse(cell.raw),
            }),
          );
          break;
        }
        draft.orgUnitId = unit.id;
        break;
      }
      case "project.title_el":
        break; // already read
      case "project.budget_article": {
        if (cell.kind === "empty") {
          exceptions.push(
            exception("V05", "WARN", rowNo, title, null, {
              articles: profile.budget_articles.join(", "),
              value: "",
            }),
          );
          break;
        }
        // The article is text even when Excel stored it as a number: 08021
        // loses its leading zero the moment somebody retypes the cell.
        const value =
          cell.kind === "number" ? String(cell.number).padStart(5, "0") : collapse(cell.raw);
        if (!profile.budget_articles.includes(value)) {
          exceptions.push(
            exception("V05", "WARN", rowNo, title, value, {
              articles: profile.budget_articles.join(", "),
              value,
            }),
          );
          break;
        }
        draft.budgetArticle = value;
        break;
      }
      case "project.commitment_flag": {
        const read = readFlag(cell);
        draft.commitmentFlag = read.flag;
        draft.commitmentNote = read.note;
        break;
      }
      case "project.action_plan_ref": {
        const read = readFlag(cell);
        draft.actionPlanRef = read.flag ? read.note : null;
        break;
      }
      case "project.in_budget_2026": {
        const read = readFlag(cell);
        draft.inBudget2026 = read.flag;
        draft.inBudget2026Note = read.note;
        break;
      }
      case "project.contractual_commitment":
        draft.contractualCommitment = readFlag(cell).flag;
        break;
      case "project.internal_audit_file":
        draft.internalAuditFile = readFlag(cell).flag;
        break;
      case "project.funding_source": {
        if (cell.kind === "empty") {
          defaultsApplied.push(`${column}=${profile.funding_default}`);
          break;
        }
        const mapped = lookup(profile.funding_map, cell.raw);
        if (mapped) draft.fundingSource = mapped;
        else unmapped.push({ column, value: collapse(cell.raw) });
        break;
      }
      case "project.external_funding_amount":
        draft.externalFundingAmount = amountOf(cell, column, rowNo, title, exceptions);
        break;
      case "project.approved_budget":
        draft.approvedBudget = amountOf(cell, column, rowNo, title, exceptions);
        break;
      case "project.planned_start":
        draft.plannedStart = dateOf(cell, column, rowNo, title, exceptions);
        break;
      case "project.planned_finish":
        draft.plannedFinish = dateOf(cell, column, rowNo, title, exceptions);
        break;
      case "project.forecast_start":
        draft.forecastStart = dateOf(cell, column, rowNo, title, exceptions);
        break;
      case "project.forecast_finish":
        draft.forecastFinish = dateOf(cell, column, rowNo, title, exceptions);
        break;
      case "project.phase": {
        if (cell.kind === "empty") {
          defaultsApplied.push(`${column}=${profile.phase_default}`);
          break;
        }
        draft.phaseSource = collapse(cell.raw);
        const mapped = lookup(profile.phase_map, cell.raw);
        if (mapped) draft.phase = mapped;
        else unmapped.push({ column, value: collapse(cell.raw) });
        break;
      }
      case "project_note.technical":
        break; // read below, verbatim
      default:
        if (spec.target.startsWith("budget_line.") || spec.target.startsWith("cost_txn.")) break;
        throw new Error(
          `The profile ${profile.profile} maps column ${column} to ${spec.target}, which the importer does not know.`,
        );
    }
  }

  // CAPEX-03 §2 col AD: verbatim, however long. These are the delay
  // narratives and the only audit trail of why dates moved.
  const noteColumn = columnFor(profile, "project_note.technical");
  const noteCell = cellOf(row, noteColumn);
  const technicalNote = noteCell.kind === "empty" ? null : noteCell.raw.trim();

  // CAPEX-03 §8 budget_vintages.
  const budgetLines: BudgetLineDraft[] = [];
  for (const vintage of profile.budget_vintages) {
    for (const [year, column] of Object.entries(vintage.columns)) {
      const cell = cellOf(row, column);
      const value = amountOf(cell, column, rowNo, title, exceptions);
      if (value === null) continue;
      budgetLines.push({
        vintageId: vintage.id,
        lineType: vintage.type,
        budgetYear: Number(year),
        amount: value,
        column,
      });
    }
  }

  const openingActual = amountOf(
    cellOf(row, profile.opening_actual.column),
    profile.opening_actual.column,
    rowNo,
    title,
    exceptions,
  );

  return {
    rowNo,
    classification: "PROJECT",
    titleRaw: title,
    project: draft,
    budgetLines,
    openingActual,
    technicalNote,
    exceptions,
    amounts,
    defaultsApplied,
    unmapped,
  };
}

function lookup(map: Record<string, string>, raw: string): string | null {
  const folded = key(raw);
  for (const [from, to] of Object.entries(map)) {
    if (key(from) === folded) return to;
  }
  return null;
}
