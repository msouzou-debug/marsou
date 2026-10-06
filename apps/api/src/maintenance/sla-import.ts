/**
 * R32 — the SLA catalogue importer, as pure functions over cells.
 *
 * The brief says the SLAs exist and will be uploaded (§1), so the job is to
 * read the contract's table faithfully, not to guess at it. Nothing here
 * touches the database: the service reads the workbook into rows, hands them
 * here, and writes what comes back — the good rows in one transaction, the
 * bad ones reported by row number with a Greek sentence saying what to fix.
 *
 * Two rules, the same two the capex importer lives by (CAPEX-03 §2):
 *  - Columns are found by their header, never by position, so a sheet with
 *    the penalty columns moved still reads.
 *  - A cell that is not a number where a number belongs is an error row,
 *    never a zero. A zero response time would be a contract nobody signed.
 *
 * The template the API hands out (`template.xlsx`) is written from the same
 * constants, so the file that goes out is the file that comes back in.
 */
import type { PmFrequency, SlaBand } from "@ecapital/shared";

/** Row 1 of the sheet, in this order, in the contract's Greek. */
export const SLA_COLUMNS = [
  { key: "code", header: "Κωδικός", required: true },
  { key: "nameEl", header: "Σύστημα", required: true },
  { key: "band", header: "Κατηγορία", required: true },
  { key: "responseHours", header: "Ανταπόκριση (ώρες)", required: true },
  { key: "restoreHours", header: "Αποκατάσταση (ώρες)", required: true },
  { key: "reportHours", header: "Έκθεση (ώρες)", required: true },
  { key: "pmFrequencies", header: "Προληπτική συντήρηση", required: false },
  { key: "penaltyPmPerDay", header: "Ρήτρα ΠΣ (€/ημέρα)", required: false },
  { key: "penaltyResponsePerHour", header: "Ρήτρα ανταπόκρισης (€/ώρα)", required: false },
  { key: "penaltyRestorePerHour", header: "Ρήτρα αποκατάστασης (€/ώρα)", required: false },
] as const;

export type SlaColumnKey = (typeof SLA_COLUMNS)[number]["key"];

/** How the template spells a band, and what the importer writes back out. */
export const BAND_LABEL_EL: Record<SlaBand, string> = {
  CRITICAL: "Κρίσιμο",
  P1: "Προτεραιότητα 1",
  P2: "Προτεραιότητα 2",
};

/** The programme table's own words («Μηνιαία», «Τριμηνιαία»…). */
export const FREQUENCY_LABEL_EL: Record<PmFrequency, string> = {
  DAILY: "Ημερήσια",
  WEEKLY: "Εβδομαδιαία",
  MONTHLY: "Μηνιαία",
  QUARTERLY: "Τριμηνιαία",
  SEMIANNUAL: "Εξαμηνιαία",
  ANNUAL: "Ετήσια",
};

const FREQUENCY_ORDER: PmFrequency[] = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
];

/**
 * The stems the programme tables use, with and without the gender the
 * clerk happened to type («Μηνιαία», «Μηνιαίοι», «Μηνιαίος»). Matched from
 * the start of the word, so «Τριμηνιαία» is never read as «Μηνιαία».
 */
const FREQUENCY_STEMS: [string, PmFrequency][] = [
  ["ημερησι", "DAILY"],
  ["καθημεριν", "DAILY"],
  ["εβδομαδιαι", "WEEKLY"],
  ["μηνιαι", "MONTHLY"],
  ["τριμηνιαι", "QUARTERLY"],
  ["εξαμηνιαι", "SEMIANNUAL"],
  ["ετησι", "ANNUAL"],
];

export interface SheetRowInput {
  /** The spreadsheet's own row number, 1-based, so a report line can be found again. */
  rowNo: number;
  /** Column A first. Primitive values: what `cellValue` made of each cell. */
  values: unknown[];
}

export interface ParsedSlaRow {
  row: number;
  code: string;
  nameEl: string;
  band: SlaBand;
  responseHours: number;
  restoreHours: number;
  reportHours: number;
  pmFrequencies: PmFrequency[];
  penaltyPmPerDay: number | null;
  penaltyResponsePerHour: number | null;
  penaltyRestorePerHour: number | null;
}

export interface SlaRowError {
  row: number;
  messageEl: string;
}

export interface ParsedSlaSheet {
  rows: ParsedSlaRow[];
  errors: SlaRowError[];
}

/**
 * What an exceljs cell value is, as a primitive. Rich text is its text, a
 * formula is the value Excel last calculated, a hyperlink is its label. A
 * date is left a Date: nothing in this sheet is a date, so a Date where a
 * number belongs is an error like any other.
 */
export function cellValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || value instanceof Date) return value;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.richText)) {
    return (record.richText as { text?: string }[]).map((part) => part.text ?? "").join("");
  }
  if ("formula" in record || "sharedFormula" in record) return cellValue(record.result ?? null);
  if (typeof record.text === "string") return record.text;
  if ("error" in record) return null;
  return null;
}

/** Lower case, no accents, no punctuation — how two spellings of a word are compared. */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A header with its bracketed unit taken off: «Ανταπόκριση (ώρες)» → «ανταποκριση». */
function headerKey(text: string): string {
  return normalise(text.replace(/\([^)]*\)/g, " "));
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value ? "1" : "0";
  return "";
}

function isBlank(value: unknown): boolean {
  return textOf(value) === "";
}

/** A number cell, or a string that is plainly one («0,5», «24»). Anything else is not. */
function numberOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s/g, "");
  if (!/^-?\d+([.,]\d+)?$/.test(text)) return null;
  return Number(text.replace(",", "."));
}

export function parseBand(value: unknown): SlaBand | null {
  const text = normalise(textOf(value));
  if (!text) return null;
  if (text === "critical" || text.startsWith("κρισιμ")) return "CRITICAL";
  const compact = text.replace(/\s+/g, "");
  if (compact === "p1" || /^προτεραιοτητα[σ]?1$/.test(compact)) return "P1";
  if (compact === "p2" || /^προτεραιοτητα[σ]?2$/.test(compact)) return "P2";
  return null;
}

/**
 * «Εξαμηνιαία, Μηνιαίοι» → ["MONTHLY", "SEMIANNUAL"]. The enum names are
 * accepted too, so a sheet exported by another system reads. Returns null
 * when any part is not a frequency, so the row is reported and not half-read.
 */
export function parseFrequencies(value: unknown): PmFrequency[] | null {
  const text = textOf(value);
  if (!text) return [];
  const found = new Set<PmFrequency>();
  for (const part of text.split(/[,;/\n+]|\s+και\s+/)) {
    const raw = part.trim();
    if (!raw) continue;
    const upper = raw.toUpperCase();
    if ((FREQUENCY_ORDER as string[]).includes(upper)) {
      found.add(upper as PmFrequency);
      continue;
    }
    const word = normalise(raw);
    const hit = FREQUENCY_STEMS.find(([stem]) => word.startsWith(stem));
    if (!hit) return null;
    found.add(hit[1]);
  }
  return FREQUENCY_ORDER.filter((frequency) => found.has(frequency));
}

/**
 * The sheet, read. Row 1 is the header; every non-blank row after it is
 * either a parsed system or an error line. A code that appears twice is an
 * error on the second appearance — the first one wins, as it would on paper.
 */
export function parseSlaSheet(rows: SheetRowInput[]): ParsedSlaSheet {
  const header = rows.find((row) => row.values.some((value) => !isBlank(value)));
  if (!header) {
    return {
      rows: [],
      errors: [{ row: 1, messageEl: "Το αρχείο δεν έχει γραμμές. Κατεβάστε το υπόδειγμα, συμπληρώστε τα συστήματα και ανεβάστε το ξανά." }],
    };
  }

  const columnOf = new Map<SlaColumnKey, number>();
  header.values.forEach((value, index) => {
    const key = headerKey(textOf(value));
    const column = SLA_COLUMNS.find((c) => headerKey(c.header) === key);
    if (column && !columnOf.has(column.key)) columnOf.set(column.key, index);
  });
  const missing = SLA_COLUMNS.filter((c) => c.required && !columnOf.has(c.key));
  if (missing.length) {
    return {
      rows: [],
      errors: [
        {
          row: header.rowNo,
          messageEl: `Λείπουν οι στήλες ${missing.map((c) => `«${c.header}»`).join(", ")} από τη γραμμή επικεφαλίδων. Κατεβάστε το υπόδειγμα και κρατήστε τις επικεφαλίδες του όπως είναι.`,
        },
      ],
    };
  }

  const parsed: ParsedSlaRow[] = [];
  const errors: SlaRowError[] = [];
  const seenCodes = new Set<string>();

  for (const row of rows) {
    if (row.rowNo <= header.rowNo) continue;
    const cell = (key: SlaColumnKey): unknown => {
      const index = columnOf.get(key);
      return index === undefined ? null : (row.values[index] ?? null);
    };
    if (SLA_COLUMNS.every((c) => isBlank(cell(c.key)))) continue;

    const problems: string[] = [];
    const code = textOf(cell("code"));
    const nameEl = textOf(cell("nameEl"));
    if (!code) problems.push("λείπει ο κωδικός");
    else if (code.length > 20) problems.push(`ο κωδικός «${code}» είναι μεγαλύτερος από 20 χαρακτήρες`);
    if (nameEl.length < 2) problems.push("λείπει η ονομασία του συστήματος");
    else if (nameEl.length > 500) problems.push("η ονομασία του συστήματος ξεπερνά τους 500 χαρακτήρες");

    const band = parseBand(cell("band"));
    if (!band) {
      problems.push(
        `η κατηγορία «${textOf(cell("band"))}» δεν αναγνωρίζεται· γράψτε Κρίσιμο, Προτεραιότητα 1 ή Προτεραιότητα 2`,
      );
    }

    const hours = (key: "responseHours" | "restoreHours" | "reportHours", label: string) => {
      const value = numberOf(cell(key));
      if (value === null || value <= 0 || value > 9999) {
        problems.push(`ο χρόνος ${label} «${textOf(cell(key))}» δεν είναι θετικός αριθμός ωρών`);
        return 0;
      }
      return value;
    };
    const responseHours = hours("responseHours", "ανταπόκρισης");
    const restoreHours = hours("restoreHours", "αποκατάστασης");
    const reportHours = hours("reportHours", "έκθεσης");

    const pmFrequencies = parseFrequencies(cell("pmFrequencies"));
    if (pmFrequencies === null) {
      problems.push(
        `η συχνότητα «${textOf(cell("pmFrequencies"))}» δεν αναγνωρίζεται· γράψτε Ημερήσια, Εβδομαδιαία, Μηνιαία, Τριμηνιαία, Εξαμηνιαία ή Ετήσια, χωρισμένα με κόμμα`,
      );
    }

    const rate = (
      key: "penaltyPmPerDay" | "penaltyResponsePerHour" | "penaltyRestorePerHour",
      label: string,
    ): number | null => {
      const value = cell(key);
      if (isBlank(value)) return null;
      const amount = numberOf(value);
      if (amount === null || amount < 0) {
        problems.push(`η ${label} «${textOf(value)}» δεν είναι ποσό σε ευρώ`);
        return null;
      }
      return Math.round(amount * 100) / 100;
    };
    const penaltyPmPerDay = rate("penaltyPmPerDay", "ρήτρα προληπτικής συντήρησης");
    const penaltyResponsePerHour = rate("penaltyResponsePerHour", "ρήτρα ανταπόκρισης");
    const penaltyRestorePerHour = rate("penaltyRestorePerHour", "ρήτρα αποκατάστασης");

    if (code && seenCodes.has(code)) {
      problems.push(`ο κωδικός «${code}» υπάρχει ήδη σε προηγούμενη γραμμή του αρχείου`);
    }

    if (problems.length) {
      errors.push({ row: row.rowNo, messageEl: `${capitalise(problems.join("· "))}. Διορθώστε τη γραμμή και ανεβάστε το αρχείο ξανά.` });
      continue;
    }
    seenCodes.add(code);
    parsed.push({
      row: row.rowNo,
      code,
      nameEl,
      band: band as SlaBand,
      responseHours,
      restoreHours,
      reportHours,
      pmFrequencies: pmFrequencies ?? [],
      penaltyPmPerDay,
      penaltyResponsePerHour,
      penaltyRestorePerHour,
    });
  }

  return { rows: parsed, errors };
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase("el") + text.slice(1) : text;
}

/** One catalogue line as the template writes it: the import format, row for row. */
export function templateRow(system: {
  code: string;
  nameEl: string;
  band: SlaBand;
  responseHours: number;
  restoreHours: number;
  reportHours: number;
  pmFrequencies: PmFrequency[];
  penaltyPmPerDay: number | null;
  penaltyResponsePerHour: number | null;
  penaltyRestorePerHour: number | null;
}): (string | number | null)[] {
  return [
    system.code,
    system.nameEl,
    BAND_LABEL_EL[system.band],
    system.responseHours,
    system.restoreHours,
    system.reportHours,
    system.pmFrequencies.map((f) => FREQUENCY_LABEL_EL[f]).join(", "),
    system.penaltyPmPerDay,
    system.penaltyResponsePerHour,
    system.penaltyRestorePerHour,
  ];
}
