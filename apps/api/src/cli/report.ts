/**
 * The reconciliation report — CAPEX-03 §9.
 *
 * R41, CAPEX-01 §9: "Every import produces a reconciliation report: rows in,
 * rows created, rows rejected with reason, and a value total that must tie
 * back to the source file. Do not import silently."
 *
 * One page, in Greek, printed before anything is committed and optionally
 * written to a file with `--report`. The same object is stored in
 * `import_batch.report`, so the page can be reprinted a year later without
 * the spreadsheet.
 *
 * Every sentence in it says what is wrong and what to do about it; the
 * sentences themselves are in apps/api/src/i18n/el.json, keyed, so they are
 * translated and reviewed like every other string the system shows (R43,
 * R46).
 */
import { I18nService } from "../common/i18n.service";
import { formatEur } from "./text";

export type Severity = "ERROR" | "WARN" | "INFO";

export interface ReportException {
  rule: string;
  severity: Severity;
  rowNo: number | null;
  projectTitle: string | null;
  value: string | null;
  messageEl: string;
  messageEn: string;
}

export interface ReportColumnTotal {
  column: string;
  header: string;
  imported: number;
  footer: number | null;
  ok: boolean;
}

export interface ReportDiffChange {
  rowNo: number | null;
  title: string;
  unit: string;
  field: string;
  from: number | null;
  to: number | null;
}

export interface RunReport {
  profileId: string;
  profilePath: string;
  sheet: string;
  fileName: string;
  sha256: string;
  asOf: string;
  actor: string;
  committed: boolean;
  blocked: boolean;
  blockingRules: string[];
  stoppedOnCounts: boolean;
  expectedCounts: { project: number; footer: number };
  counts: {
    in: number;
    project: number;
    footer: number;
    skipped: number;
    created: number;
    updated: number;
    unchanged: number;
    rejected: number;
  };
  columnTotals: ReportColumnTotal[];
  ruleCounts: { rule: string; severity: Severity; count: number }[];
  exceptions: ReportException[];
  diff: {
    previousBatchId: string | null;
    previousAt: string | null;
    added: { rowNo: number | null; title: string; unit: string }[];
    removed: { title: string; unit: string }[];
    changed: ReportDiffChange[];
  };
  unmapped: { column: string; value: string; rows: number[] }[];
  defaults: { what: string; count: number }[];
  deferred: { column: string; target: string; until: string; rows: number; sum: number }[];
  writtenRows: { budgetLines: number; costTxns: number; notes: number };
}

const el = new I18nService("el");
const t = (k: string, p: Record<string, string> = {}): string => el.translate(`import.${k}`, "el", p);

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(String).join(" | ")} |`).join("\n");
  return rows.length ? `${head}\n${rule}\n${body}` : `${head}\n${rule}\n| ${headers.map(() => "—").join(" | ")} |`;
}

const tick = (ok: boolean): string => (ok ? t("report.pass") : t("report.fail"));

/** The whole page, in Greek Markdown. */
export function renderReport(report: RunReport): string {
  const out: string[] = [];

  out.push(`# ${t("report.title")}`);
  out.push("");
  out.push(
    table(
      [t("report.field"), t("report.value")],
      [
        [t("report.file"), report.fileName],
        [t("report.sheet"), report.sheet],
        [t("report.profile"), `${report.profileId}`],
        [t("report.sha256"), `\`${report.sha256}\``],
        [t("report.asOf"), report.asOf],
        [t("report.actor"), report.actor],
        [
          t("report.mode"),
          report.committed ? t("report.modeCommitted") : t("report.modeDryRun"),
        ],
      ],
    ),
  );
  out.push("");

  if (report.stoppedOnCounts) {
    out.push(`## ${t("report.stopHeading")}`);
    out.push("");
    out.push(
      t("errors.countMismatch", {
        project: String(report.counts.project),
        expectedProject: String(report.expectedCounts.project),
        footer: String(report.counts.footer),
        expectedFooter: String(report.expectedCounts.footer),
      }),
    );
    out.push("");
  }

  out.push(`## ${t("report.rowsHeading")}`);
  out.push("");
  out.push(
    table(
      [t("report.what"), t("report.count")],
      [
        [t("report.rowsIn"), report.counts.in],
        [t("report.rowsProject"), `${report.counts.project} (${report.expectedCounts.project})`],
        [t("report.rowsFooter"), `${report.counts.footer} (${report.expectedCounts.footer})`],
        [t("report.rowsSkipped"), report.counts.skipped],
      ],
    ),
  );
  out.push("");

  out.push(`## ${t("report.writesHeading")}`);
  out.push("");
  out.push(
    table(
      [t("report.what"), t("report.count")],
      [
        [t("report.created"), report.counts.created],
        [t("report.updated"), report.counts.updated],
        [t("report.unchanged"), report.counts.unchanged],
        [t("report.rejected"), report.counts.rejected],
        [t("report.budgetLines"), report.writtenRows.budgetLines],
        [t("report.costTxns"), report.writtenRows.costTxns],
        [t("report.notes"), report.writtenRows.notes],
      ],
    ),
  );
  out.push("");

  out.push(`## ${t("report.totalsHeading")}`);
  out.push("");
  out.push(t("report.totalsIntro"));
  out.push("");
  out.push(
    table(
      [t("report.column"), t("report.header"), t("report.sumImported"), t("report.sumFile"), t("report.check")],
      report.columnTotals.map((c) => [
        c.column,
        c.header,
        formatEur(c.imported),
        c.footer === null ? "—" : formatEur(c.footer),
        tick(c.ok),
      ]),
    ),
  );
  out.push("");

  out.push(`## ${t("report.exceptionsHeading")}`);
  out.push("");
  if (report.ruleCounts.length === 0) {
    out.push(t("report.noExceptions"));
    out.push("");
  } else {
    out.push(
      table(
        [t("report.rule"), t("report.severity"), t("report.count"), t("report.ruleName")],
        report.ruleCounts.map((r) => [
          r.rule,
          t(`severity.${r.severity}`),
          r.count,
          t(`ruleNames.${r.rule}`),
        ]),
      ),
    );
    out.push("");
    for (const rule of report.ruleCounts) {
      const rows = report.exceptions.filter((e) => e.rule === rule.rule);
      out.push(`### ${rule.rule} — ${t(`ruleNames.${rule.rule}`)}`);
      out.push("");
      out.push(
        table(
          [t("report.row"), t("report.project"), t("report.offendingValue"), t("report.message")],
          rows.map((e) => [
            e.rowNo ?? "—",
            e.projectTitle ?? "—",
            e.value ?? "—",
            e.messageEl,
          ]),
        ),
      );
      out.push("");
    }
  }

  out.push(`## ${t("report.diffHeading")}`);
  out.push("");
  if (!report.diff.previousBatchId) {
    out.push(t("report.noPrevious"));
  } else {
    out.push(t("report.previousWas", { at: report.diff.previousAt ?? "—" }));
    out.push("");
    out.push(
      table(
        [t("report.what"), t("report.count")],
        [
          [t("report.diffAdded"), report.diff.added.length],
          [t("report.diffRemoved"), report.diff.removed.length],
          [t("report.diffChanged"), report.diff.changed.length],
        ],
      ),
    );
    if (report.diff.changed.length) {
      out.push("");
      out.push(
        table(
          [t("report.row"), t("report.project"), t("report.unit"), t("report.field"), t("report.before"), t("report.after")],
          report.diff.changed.map((c) => [
            c.rowNo ?? "—",
            c.title,
            c.unit,
            t(`fields.${c.field}`),
            c.from === null ? "—" : formatEur(c.from),
            c.to === null ? "—" : formatEur(c.to),
          ]),
        ),
      );
    }
    if (report.diff.removed.length) {
      out.push("");
      out.push(t("report.removedIntro"));
      out.push("");
      out.push(
        table(
          [t("report.project"), t("report.unit")],
          report.diff.removed.map((r) => [r.title, r.unit]),
        ),
      );
    }
  }
  out.push("");

  if (report.deferred.length || report.unmapped.length || report.defaults.length) {
    out.push(`## ${t("report.notesHeading")}`);
    out.push("");
    for (const d of report.deferred) {
      out.push(
        `- ${t("report.deferredColumn", {
          column: d.column,
          until: d.until,
          rows: String(d.rows),
          sum: formatEur(d.sum),
        })}`,
      );
    }
    for (const u of report.unmapped) {
      out.push(
        `- ${t("report.unmappedValue", {
          column: u.column,
          value: u.value,
          rows: u.rows.slice(0, 10).join(", "),
        })}`,
      );
    }
    for (const d of report.defaults) {
      out.push(`- ${t("report.defaultApplied", { what: d.what, count: String(d.count) })}`);
    }
    out.push("");
  }

  out.push(`## ${t("report.verdictHeading")}`);
  out.push("");
  out.push(verdict(report));
  out.push("");

  return out.join("\n");
}

function verdict(report: RunReport): string {
  if (report.stoppedOnCounts) return t("report.verdictStopped");
  if (report.blocked) {
    return t("report.verdictBlocked", { rules: report.blockingRules.join(", ") });
  }
  if (!report.committed) return t("report.verdictDryRunClean");
  return t("report.verdictCommitted", {
    created: String(report.counts.created),
    updated: String(report.counts.updated),
  });
}
