#!/usr/bin/env node
/**
 * eCapital — the capex plan import CLI (R41).
 *
 *   pnpm --filter @ecapital/api import:capex -- inspect --file <xlsx> --profile capex_plan_2026_02
 *   pnpm --filter @ecapital/api import:capex -- --file <xlsx> --profile capex_plan_2026_02 --as <email>
 *   pnpm --filter @ecapital/api import:capex -- --file <xlsx> --profile capex_plan_2026_02 --as <email> --commit
 *
 * `inspect` is the first thing anybody runs against a file they have not seen
 * before: it prints the sheets, the header row as it was detected, every
 * column with the header the file carries and the target the profile gives
 * it, and it names the columns that moved and the ones the profile does not
 * know. Nothing it does touches the database.
 *
 * `run` is the default. Without `--commit` it is a dry run: the whole import
 * happens inside one transaction, the report is produced, and the
 * transaction is rolled back (CAPEX-03 §9, ADR-0016).
 *
 * Exit codes: 0 done, 1 the run could not start, 2 the row counts did not
 * match the profile and nothing was written, 3 a blocking rule failed so the
 * run stayed a dry run.
 */
import { writeFileSync } from "node:fs";
import { I18nService } from "../common/i18n.service";
import { loadConfig } from "../config";
import { parseSheet } from "./parse";
import { columnIndex, loadProfile } from "./profile";
import { ImportError, runImport } from "./run";
import { headerOf, loadWorkbook } from "./workbook";
import { collapse, key } from "./text";

const i18n = new I18nService("el");
const el = (k: string, p: Record<string, string> = {}): string => i18n.translate(k, "el", p);
const en = (k: string, p: Record<string, string> = {}): string => i18n.translate(k, "en", p);

interface Args {
  command: "run" | "inspect";
  file: string | null;
  profile: string | null;
  commit: boolean;
  asOf: string | null;
  report: string | null;
  as: string | null;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "run",
    file: null,
    profile: null,
    commit: false,
    asOf: null,
    report: null,
    as: null,
    help: false,
  };
  // `pnpm --filter … import:capex -- --file x` hands the script its own `--`
  // as the first argument. Drop it rather than making every operator care.
  const rest = argv.filter((a, i) => !(a === "--" && i === 0));
  if (rest[0] === "inspect" || rest[0] === "run") {
    args.command = rest.shift() as "run" | "inspect";
  }
  while (rest.length) {
    const flag = rest.shift() as string;
    switch (flag) {
      case "--file":
        args.file = rest.shift() ?? null;
        break;
      case "--profile":
        args.profile = rest.shift() ?? null;
        break;
      case "--commit":
        args.commit = true;
        break;
      case "--as-of":
        args.asOf = rest.shift() ?? null;
        break;
      case "--report":
        args.report = rest.shift() ?? null;
        break;
      case "--as":
        args.as = rest.shift() ?? null;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  return args;
}

const USAGE = `
eCapital — import the capex plan into the project register (R41).

  import:capex inspect --file <xlsx> --profile <id>
  import:capex [run]   --file <xlsx> --profile <id> --as <email> [--commit]
                       [--as-of YYYY-MM-DD] [--report out.md]

  --file     the workbook to read
  --profile  the import profile: an id in src/cli/profiles, or a path to a YAML file
  --as       the person running the import; every row written is audited under them
  --commit   write. Without it the whole run is rolled back and you get the report
  --as-of    the date the opening actual balance is posted at (default: the profile's)
  --report   also write the Greek reconciliation report to this file
`.trim();

/**
 * CAPEX-01 §9: "Write an inspector that reports detected columns per file."
 * The whole point is to find out what moved before anything is imported.
 */
export async function inspect(file: string, profileName: string): Promise<string> {
  const { profile } = loadProfile(profileName);
  const workbook = await loadWorkbook(file, profile.sheet);
  const header = headerOf(workbook, profile.header_row);
  const lines: string[] = [];

  lines.push(`# ${el("import.inspect.title")}`);
  lines.push("");
  lines.push(`**${el("import.inspect.sheets")}:** ${workbook.sheetNames.join(" · ")}`);
  lines.push("");
  lines.push(
    el("import.inspect.sheetLine", {
      sheet: workbook.sheetName,
      row: String(profile.header_row),
      first: String(profile.first_data_row),
    }),
  );
  lines.push("");

  const problems: string[] = [];
  const letters = new Set<string>([...header.keys(), ...Object.keys(profile.columns)]);
  const ordered = [...letters].sort((a, b) => columnIndex(a) - columnIndex(b));

  const rows: string[][] = [];
  for (const letter of ordered) {
    const found = collapse(header.get(letter) ?? "");
    const spec = profile.columns[letter];
    let status: string;
    if (!spec) {
      if (found === "") continue; // an empty column neither side claims
      status = el("import.inspect.unknown");
      problems.push(el("import.inspect.unknownLine", { column: letter, found }));
    } else if (key(found) === key(spec.header)) {
      status = el("import.inspect.ok");
    } else if (found === "" && spec.header === "") {
      status = el("import.inspect.ok");
    } else if (found === "") {
      status = el("import.inspect.missing");
      problems.push(el("import.inspect.missingLine", { column: letter, expected: spec.header }));
    } else {
      status = el("import.inspect.moved");
      problems.push(
        el("import.inspect.movedLine", { column: letter, expected: spec.header, found }),
      );
    }
    rows.push([letter, found || "—", spec?.header || "—", spec?.target ?? "—", status]);
  }

  lines.push(
    mdTable(
      [
        el("import.inspect.column"),
        el("import.inspect.headerInFile"),
        el("import.inspect.headerInProfile"),
        el("import.inspect.target"),
        el("import.inspect.status"),
      ],
      rows,
    ),
  );
  lines.push("");

  // Classification needs no database: a footer is a footer because of what is
  // in the title column, never because of its row number (CAPEX-03 §1).
  const parsed = parseSheet(workbook, profile, new Map());
  lines.push(`## ${el("import.inspect.classification")}`);
  lines.push("");
  lines.push(
    el("import.inspect.classificationLine", {
      project: String(parsed.counts.project),
      expectedProject: String(profile.expected_counts.project),
      footer: String(parsed.counts.footer),
      expectedFooter: String(profile.expected_counts.footer),
      skipped: String(parsed.counts.skipped),
    }),
  );
  if (
    parsed.counts.project !== profile.expected_counts.project ||
    parsed.counts.footer !== profile.expected_counts.footer
  ) {
    problems.push(
      el("import.errors.countMismatch", {
        project: String(parsed.counts.project),
        expectedProject: String(profile.expected_counts.project),
        footer: String(parsed.counts.footer),
        expectedFooter: String(profile.expected_counts.footer),
      }),
    );
  }
  lines.push("");

  lines.push(`## ${el("import.inspect.problemsHeading")}`);
  lines.push("");
  if (problems.length === 0) lines.push(el("import.inspect.noProblems"));
  else for (const p of problems) lines.push(`- ${p}`);
  lines.push("");

  return lines.join("\n");
}

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const rule = `| ${headers.map(() => "---").join(" | ")} |`;
  return [head, rule, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

export async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 1;
  }
  if (args.help || !args.file || !args.profile) {
    console.log(USAGE);
    return args.help ? 0 : 1;
  }

  try {
    if (args.command === "inspect") {
      console.log(await inspect(args.file, args.profile));
      return 0;
    }
    const config = loadConfig();
    const outcome = await runImport({
      file: args.file,
      profile: args.profile,
      commit: args.commit,
      asOf: args.asOf,
      reportPath: args.report,
      actorEmail: args.as,
      databaseUrl: config.DATABASE_URL,
      migrationDatabaseUrl: config.migrationDatabaseUrl,
    });
    console.log(outcome.markdown);
    if (args.report) {
      writeFileSync(args.report, `${outcome.markdown}\n`, "utf8");
      console.log(`\n→ ${args.report}`);
    }
    return outcome.exitCode;
  } catch (error) {
    if (error instanceof ImportError) {
      console.error(el(error.messageKey, error.params));
      console.error(en(error.messageKey, error.params));
      return 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
