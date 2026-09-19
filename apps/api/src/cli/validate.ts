/**
 * The fifteen validation rules — CAPEX-03 §5's fourteen and V15, added by the
 * errata of 19/09/2026 (ADR-0024) — with the severities the spec gives them.
 *
 * R41. ERROR blocks the row, WARN imports it flagged, INFO is logged only.
 * V11 runs at batch level. The importer commits only if V04, V06, V07, V10,
 * V11, V12, V13 and V15 all pass (§9); everything else imports flagged, and
 * nothing is ever fixed in the spreadsheet — the exceptions go into the
 * report and somebody at Technical Services resolves them in the system with
 * their name against it.
 *
 * V03, V04, V05, V06 and V15 fire while the cells are being read and come out
 * of `parse.ts`; the rest need the whole row, or the whole file, and are here.
 */
import type { ImportException, ParseResult } from "./parse";
import type { ImportProfile } from "./profile";
import { formatEur, toCents } from "./text";

/**
 * §9: these have to pass or the run stays a dry run. V15 is one of them for
 * the same reason V04 is — a row whose unit could not be resolved has nowhere
 * to go — except that V15's row has a unit and it is the wrong organisation's.
 * Importing it would put another body's capital works in ΟΚΥπΥ's register.
 */
export const BLOCKING_RULES = ["V04", "V06", "V07", "V10", "V11", "V12", "V13", "V15"] as const;

export interface ColumnTotal {
  column: string;
  imported: number;
  footer: number | null;
  ok: boolean;
}

export interface ValidationResult {
  /** Batch-level exceptions (V11). Row-level ones live on the row. */
  batchExceptions: ImportException[];
  columnTotals: ColumnTotal[];
  /** Rows that carry at least one ERROR and are therefore not imported. */
  rejectedRows: Set<number>;
  blocked: boolean;
  blockingRules: string[];
}

function exception(
  rule: string,
  severity: "ERROR" | "WARN" | "INFO",
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

export function validate(parsed: ParseResult, profile: ImportProfile): ValidationResult {
  const projects = parsed.rows.filter((r) => r.classification === "PROJECT");
  const forecastVintage = profile.budget_vintages.find((v) => v.type === "FORECAST");

  const seen = new Map<string, number>();

  for (const row of projects) {
    const draft = row.project;
    if (!draft) continue;
    const title = draft.titleEl;

    const forecastTotal = row.budgetLines
      .filter((l) => l.vintageId === forecastVintage?.id)
      .reduce((sum, l) => sum + toCents(l.amount), 0);
    const actual = toCents(row.openingActual ?? 0);

    // V01 — estimated total (O) = actual (S) + forecast years (U:X), ±€10.
    if (draft.approvedBudget !== null) {
      const diff = toCents(draft.approvedBudget) - (actual + forecastTotal);
      if (Math.abs(diff) > toCents(profile.v01_tolerance_eur)) {
        row.exceptions.push(
          exception("V01", "WARN", row.rowNo, title, formatEur(diff / 100), {
            diff: formatEur(diff / 100),
            total: formatEur(draft.approvedBudget),
            sum: formatEur((actual + forecastTotal) / 100),
          }),
        );
      }
    }

    // V02 — estimated total present and greater than zero.
    if (draft.approvedBudget === null || draft.approvedBudget <= 0) {
      row.exceptions.push(
        exception("V02", "WARN", row.rowNo, title, draft.approvedBudget === null ? null : "0"),
      );
    }

    // V07 — a finish never precedes its start.
    for (const [start, finish, what] of [
      [draft.plannedStart, draft.plannedFinish, "planned"],
      [draft.forecastStart, draft.forecastFinish, "forecast"],
    ] as const) {
      if (start && finish && finish < start) {
        row.exceptions.push(
          exception("V07", "ERROR", row.rowNo, title, `${start} → ${finish}`, {
            start,
            finish,
            which: what,
          }),
        );
      }
    }

    // V08 — a finished project has spent what it was going to spend.
    if (
      profile.completed_phases.includes(draft.phase) &&
      draft.approvedBudget !== null &&
      draft.approvedBudget > 0
    ) {
      const ratio = (row.openingActual ?? 0) / draft.approvedBudget;
      if (ratio < profile.v08_min_actual_ratio) {
        row.exceptions.push(
          exception("V08", "WARN", row.rowNo, title, `${Math.round(ratio * 100)}%`, {
            pct: `${Math.round(ratio * 100)}%`,
            min: `${Math.round(profile.v08_min_actual_ratio * 100)}%`,
          }),
        );
      }
    }

    // V09 — in preparation and contractually committed at the same time.
    if (draft.phase === profile.preparation_phase && draft.contractualCommitment) {
      row.exceptions.push(exception("V09", "WARN", row.rowNo, title, null));
    }

    // V10 — actual spend is never negative.
    if (row.openingActual !== null && row.openingActual < 0) {
      row.exceptions.push(
        exception("V10", "ERROR", row.rowNo, title, formatEur(row.openingActual), {
          value: formatEur(row.openingActual),
        }),
      );
    }

    // V12 — external funding never exceeds the cost of the project it funds.
    if (
      draft.externalFundingAmount !== null &&
      draft.approvedBudget !== null &&
      toCents(draft.externalFundingAmount) > toCents(draft.approvedBudget)
    ) {
      row.exceptions.push(
        exception("V12", "ERROR", row.rowNo, title, formatEur(draft.externalFundingAmount), {
          funding: formatEur(draft.externalFundingAmount),
          total: formatEur(draft.approvedBudget),
        }),
      );
    }

    // V13 — the natural key is unique (§2 col E: unit + normalised title).
    if (draft.orgUnitId) {
      const naturalKey = `${draft.orgUnitId}::${draft.titleNormalised}`;
      const first = seen.get(naturalKey);
      if (first !== undefined) {
        row.exceptions.push(
          exception("V13", "ERROR", row.rowNo, title, draft.titleEl, {
            other: String(first),
            unit: draft.unitSource ?? draft.orgUnitId,
          }),
        );
      } else {
        seen.set(naturalKey, row.rowNo);
      }
    }

    // V14 — a forecast year column is never negative.
    for (const line of row.budgetLines) {
      if (line.vintageId === forecastVintage?.id && line.amount < 0) {
        row.exceptions.push(
          exception("V14", "WARN", row.rowNo, title, formatEur(line.amount), {
            year: line.budgetYear === 9999 ? "μετά" : String(line.budgetYear),
            value: formatEur(line.amount),
            column: line.column,
          }),
        );
      }
    }
  }

  // V11 — the sum of what was read ties to the file's own footer total, per
  // column, to the cent. It compares every PROJECT row, including the ones a
  // rule rejected: the question this rule answers is whether the importer
  // read the same file Excel added up, not whether every row was importable.
  const batchExceptions: ImportException[] = [];
  const columnTotals: ColumnTotal[] = [];
  for (const column of profile.footer_total_columns) {
    const imported = projects.reduce((sum, r) => sum + toCents(r.amounts.get(column) ?? 0), 0);
    const footerRaw = parsed.footerTotals.get(column);
    const footer = footerRaw === undefined ? null : toCents(footerRaw);
    const ok = footer !== null && footer === imported;
    columnTotals.push({
      column,
      imported: imported / 100,
      footer: footer === null ? null : footer / 100,
      ok,
    });
    if (!ok) {
      batchExceptions.push(
        exception("V11", "ERROR", parsed.footerRowNo, null, null, {
          column,
          imported: formatEur(imported / 100),
          footer: footer === null ? "—" : formatEur(footer / 100),
          diff: footer === null ? "—" : formatEur((imported - footer) / 100),
        }),
      );
    }
  }

  const rejectedRows = new Set<number>(
    projects.filter((r) => r.exceptions.some((e) => e.severity === "ERROR")).map((r) => r.rowNo),
  );

  const fired = new Set<string>([
    ...projects.flatMap((r) => r.exceptions.filter((e) => e.severity === "ERROR").map((e) => e.rule)),
    ...batchExceptions.filter((e) => e.severity === "ERROR").map((e) => e.rule),
  ]);
  const blockingRules = BLOCKING_RULES.filter((r) => fired.has(r));

  return {
    batchExceptions,
    columnTotals,
    rejectedRows,
    blocked: blockingRules.length > 0,
    blockingRules: [...blockingRules],
  };
}

/** Every exception of a run, rows first, in row order then rule order. */
export function allExceptions(parsed: ParseResult, result: ValidationResult): ImportException[] {
  const rows = parsed.rows.flatMap((r) => r.exceptions);
  return [...rows, ...result.batchExceptions].sort(
    (a, b) => (a.rowNo ?? 0) - (b.rowNo ?? 0) || a.rule.localeCompare(b.rule),
  );
}

export function countByRule(exceptions: ImportException[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of exceptions) counts.set(e.rule, (counts.get(e.rule) ?? 0) + 1);
  return counts;
}
