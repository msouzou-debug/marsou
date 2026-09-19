/**
 * The import profile: CAPEX-03 §8's YAML, loaded and validated.
 *
 * R41. The mapping is data, not code (ADR-0016): a column that moved, a
 * header that was reworded, a footer line that was renamed or a different
 * expected row count are edits to a YAML file, and the next revision of the
 * spreadsheet is a new profile next to this one. What the profile may NOT
 * invent is a way of reading a cell — every column names one of the
 * transforms in `Transform` below, and a genuinely new kind of cell is a code
 * change with an ADR behind it.
 *
 * Everything here is validated with zod at load time, so a profile with a
 * typo fails before the file is opened rather than half way through a row.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** How a cell is read. The vocabulary is closed; see the file header. */
export const Transform = z.enum([
  "ignore",
  "text",
  "amount",
  "date",
  "category",
  "directorate",
  "org_unit",
  "title",
  "budget_article",
  "flag",
  "flag_with_note",
  "flag_with_ref",
  "funding_source",
  "phase",
  "note",
]);
export type Transform = z.infer<typeof Transform>;

const ColumnLetter = z
  .string()
  .regex(/^[A-Z]{1,2}$/, "a column is one or two capital Latin letters, e.g. E or AB");

export const ColumnSpec = z.object({
  /** The header text as the sheet spells it, used by `inspect` to find drift. */
  header: z.string(),
  /** Where the value lands. `none` for a column that is read and ignored. */
  target: z.string(),
  transform: Transform,
});
export type ColumnSpec = z.infer<typeof ColumnSpec>;

const YearKey = z.union([z.number().int(), z.string().regex(/^\d{4}$/)]).transform(Number);

export const BudgetVintage = z.object({
  id: z.string().min(1),
  type: z.enum(["FORECAST", "BUDGET"]),
  columns: z.record(YearKey, ColumnLetter),
});
export type BudgetVintage = z.infer<typeof BudgetVintage>;

export const ImportProfile = z
  .object({
    profile: z.string().min(1),
    source: z.string().min(1).default("EXCEL_CAPEX_PLAN"),
    period: z.string().nullable().default(null),
    sheet: z.string().min(1),
    header_row: z.number().int().positive(),
    first_data_row: z.number().int().positive(),
    /** `auto` stops at `blank_run_to_stop` consecutive blank title cells. */
    last_data_row: z.union([z.literal("auto"), z.number().int().positive()]).default("auto"),
    blank_run_to_stop: z.number().int().positive().default(20),
    footer_titles: z.array(z.string().min(1)).min(1),
    natural_key: z.array(z.string().min(1)).min(1),
    expected_counts: z.object({
      project: z.number().int().nonnegative(),
      footer: z.number().int().nonnegative(),
    }),
    title_note_prefixes: z.array(z.string().min(1)).default([]),
    budget_articles: z.array(z.string().min(1)).min(1),
    category_map: z.record(z.string(), z.string()).default({}),
    category_default: z.string().min(1),
    directorate_map: z.record(z.string(), z.string()).default({}),
    /**
     * CAPEX-03 errata, ADR-0024: spellings in column D that name a unit
     * ΟΚΥπΥ does not run. They are not aliases with a missing row — they are
     * organisations outside the register — so a row on one of them is
     * rejected with V15 and never resolved to a unit. Matched the way every
     * other lookup in this file is: folded and collapsed.
     */
    units_out_of_scope: z.array(z.string().min(1)).default([]),
    funding_map: z.record(z.string(), z.string()).default({}),
    funding_default: z.string().min(1),
    phase_map: z.record(z.string(), z.string()),
    phase_default: z.string().min(1),
    preparation_phase: z.string().min(1),
    completed_phases: z.array(z.string().min(1)).min(1),
    v08_min_actual_ratio: z.number().positive().max(1).default(0.95),
    v01_tolerance_eur: z.number().nonnegative().default(10),
    diff_amount_threshold_eur: z.number().nonnegative().default(1000),
    budget_vintages: z.array(BudgetVintage).min(1),
    opening_actual: z.object({
      column: ColumnLetter,
      as_at: z.union([z.string(), z.date()]).transform(toIsoDate),
    }),
    ignore_columns: z.array(ColumnLetter).default([]),
    deferred_columns: z
      .array(
        z.object({
          column: ColumnLetter,
          target: z.string().min(1),
          until: z.string().min(1),
          reason_el: z.string().min(1),
          reason_en: z.string().min(1),
        }),
      )
      .default([]),
    footer_total_columns: z.array(ColumnLetter).min(1),
    footer_total_row_title: z.string().min(1),
    columns: z.record(ColumnLetter, ColumnSpec),
  })
  .superRefine((p, ctx) => {
    if (p.first_data_row <= p.header_row) {
      ctx.addIssue({
        code: "custom",
        path: ["first_data_row"],
        message: "the first data row has to come after the header row",
      });
    }
    // Every column a vintage names, the opening balance column and every
    // column the report ties back have to be columns the profile knows,
    // or the report would tie a column nobody reads.
    const known = new Set(Object.keys(p.columns));
    const named: [string, string][] = [
      [p.opening_actual.column, "opening_actual.column"],
      ...p.footer_total_columns.map((c): [string, string] => [c, "footer_total_columns"]),
      ...p.budget_vintages.flatMap((v) =>
        Object.values(v.columns).map((c): [string, string] => [c, `budget_vintages.${v.id}`]),
      ),
    ];
    // §8's natural_key is the one the importer implements (CAPEX-03 §2 col E,
    // ADR-0014). A profile that names a different key would be silently
    // ignored, which is worse than refusing to load.
    if (p.natural_key.join(",") !== "hospital,title_normalised") {
      ctx.addIssue({
        code: "custom",
        path: ["natural_key"],
        message:
          "the importer's natural key is [hospital, title_normalised]; changing it is a code change, not a profile change",
      });
    }
    for (const [column, where] of named) {
      if (!known.has(column)) {
        ctx.addIssue({
          code: "custom",
          path: [where],
          message: `column ${column} is not in the profile's column map`,
        });
      }
    }
  });
export type ImportProfile = z.infer<typeof ImportProfile>;

function toIsoDate(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`not a date: ${String(value)}`);
  return iso;
}

export const PROFILE_DIR = join(__dirname, "profiles");

/**
 * Where a profile named on the command line lives. `tsc` does not copy YAML
 * into dist/, so a build run looks next to the sources as well — the profile
 * is the same file either way.
 */
export function profilePath(nameOrPath: string): string {
  if (nameOrPath.endsWith(".yaml") || nameOrPath.endsWith(".yml")) return nameOrPath;
  const candidates = [
    join(PROFILE_DIR, `${nameOrPath}.yaml`),
    join(__dirname, "..", "..", "src", "cli", "profiles", `${nameOrPath}.yaml`),
  ];
  return candidates.find((c) => existsSync(c)) ?? candidates[0];
}

export interface LoadedProfile {
  profile: ImportProfile;
  path: string;
}

export function loadProfile(nameOrPath: string): LoadedProfile {
  const path = profilePath(nameOrPath);
  if (!existsSync(path)) {
    throw new Error(`Import profile not found: ${path}`);
  }
  const parsed = ImportProfile.safeParse(parseYaml(readFileSync(path, "utf8")));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Import profile ${path} is not usable:\n${lines.join("\n")}`);
  }
  if (parsed.data.profile !== basename(path) && !nameOrPath.includes("/")) {
    // A profile whose id does not match its file name is how two revisions
    // end up recorded against one id in import_batch.
    throw new Error(
      `Import profile ${path} calls itself ${parsed.data.profile}; the file name and the id have to agree.`,
    );
  }
  return { profile: parsed.data, path };
}

function basename(path: string): string {
  return path.split("/").pop()?.replace(/\.(yaml|yml)$/, "") ?? path;
}

/** Column letter → 1-based index, the way a spreadsheet counts. A=1, AB=28. */
export function columnIndex(letter: string): number {
  let index = 0;
  for (const ch of letter.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index;
}

/** 1-based index → column letter. */
export function columnLetter(index: number): string {
  let rest = index;
  let out = "";
  while (rest > 0) {
    const rem = (rest - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}
