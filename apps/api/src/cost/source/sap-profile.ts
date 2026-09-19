/**
 * The SAP extract profiles: one YAML file per report, loaded and validated.
 *
 * R14, R15, and the same decision ADR-0016 took for the capex plan — the
 * mapping is data, not code. A column that moved or a header somebody
 * reworded in SAP is an edit to `../profiles/me2n.yaml`; a genuinely new kind
 * of cell is a code change, because a profile may only name a target this
 * module already knows how to fill.
 *
 * The profile matches columns by header text rather than by letter. A SAP
 * export is a list, not a form: the columns come out in whatever order the
 * layout the clerk saved puts them in, and the header text is the one thing
 * that survives that.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { SapReport } from "@ecapital/shared";

/** The closed list of things a column can be. See the file header. */
export const COLUMN_TARGETS = [
  "sourceRef",
  "lineItem",
  "docDate",
  "postingDate",
  "amount",
  "description",
  "vendorName",
  "sapWbs",
  "sapPo",
  "costCentre",
  "glAccount",
] as const;
export type ColumnTarget = (typeof COLUMN_TARGETS)[number];

const ColumnSpec = z.object({
  /** Header texts this column answers to, folded before comparison. */
  headers: z.array(z.string().min(1)).min(1),
  /** A file without it cannot be read at all, and the import fails. */
  required: z.boolean().default(false),
});
export type ColumnSpec = z.infer<typeof ColumnSpec>;

export const SapProfile = z.object({
  profile: z.string().min(1),
  report: z.enum(["ME2N", "KSB1", "FBL1N"]),
  /** Which ledger the rows land in (CAPEX-01 §7). */
  txn_type: z.enum(["COMMITMENT", "ACTUAL"]),
  /** The worksheet by name; the first one when absent. */
  sheet: z.string().min(1).nullable().default(null),
  header_row: z.number().int().positive().default(1),
  first_data_row: z.number().int().positive().default(2),
  /** Stop after this many consecutive rows with nothing in them. */
  blank_run_to_stop: z.number().int().positive().default(10),
  number_format: z.enum(["european", "anglo", "auto"]).default("european"),
  date_format: z.enum(["dmy_dot", "dmy_slash", "iso", "auto"]).default("dmy_dot"),
  sign: z.enum(["as_posted", "invert"]).default("as_posted"),
  /** The separator of a .csv export; ignored for .xlsx. */
  csv_delimiter: z.string().length(1).default(";"),
  columns: z.record(z.enum(COLUMN_TARGETS), ColumnSpec),
});
export type SapProfile = z.infer<typeof SapProfile>;

export const PROFILE_DIR = join(__dirname, "..", "profiles");

const cache = new Map<string, SapProfile>();

/**
 * The profile for one report. A profile that names a target, a transform or a
 * format this module does not know fails to load here, with the file named,
 * before a workbook is opened (ADR-0016).
 */
export function loadSapProfile(report: SapReport, dir: string = PROFILE_DIR): SapProfile {
  const cacheKey = `${dir}:${report}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const path = join(dir, `${report.toLowerCase()}.yaml`);
  if (!existsSync(path)) throw new Error(`No import profile for ${report} at ${path}`);

  const parsed = SapProfile.safeParse(parseYaml(readFileSync(path, "utf8")));
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`The import profile ${path} is not usable — ${problems}`);
  }
  if (parsed.data.report !== report) {
    throw new Error(`The import profile ${path} says it is for ${parsed.data.report}`);
  }
  cache.set(cacheKey, parsed.data);
  return parsed.data;
}

/**
 * Fold a header before comparing it: accents off, capitals down, punctuation
 * and whitespace dropped. «Έγγραφο αγοράς», «ΕΓΓΡΑΦΟ ΑΓΟΡΑΣ» and
 * «Εγγραφο  αγορας.» are the same column, and a SAP layout spells it
 * differently in each of the three clients the organisation runs.
 */
export function foldHeader(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export interface ColumnIndex {
  /** target → zero-based column position in the sheet. */
  found: Map<ColumnTarget, number>;
  /** Required targets the header row does not carry. */
  missing: ColumnTarget[];
}

/** Resolve the profile's columns against a header row of a real file. */
export function indexColumns(profile: SapProfile, header: string[]): ColumnIndex {
  const folded = header.map(foldHeader);
  const found = new Map<ColumnTarget, number>();
  const missing: ColumnTarget[] = [];

  for (const [target, spec] of Object.entries(profile.columns) as [ColumnTarget, ColumnSpec][]) {
    const wanted = spec.headers.map(foldHeader);
    const position = folded.findIndex((cell) => cell !== "" && wanted.includes(cell));
    if (position >= 0) found.set(target, position);
    else if (spec.required) missing.push(target);
  }
  return { found, missing };
}
