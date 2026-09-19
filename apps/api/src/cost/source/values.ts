/**
 * Reading the values a SAP extract carries: Greek and SAP number formats,
 * four date formats, and the sign conventions each report posts with.
 *
 * Pure functions over strings, so the awkward cases can be tested without a
 * spreadsheet and without a database. The awkward cases are the point — an
 * ME2N exported from a Greek SAP client writes «1.234,56», puts the minus on
 * the right («1.234,56-»), and dates its documents «31.03.2026».
 *
 * RULE (ADR-0016, and CAPEX-03 §5 V06): a cell that cannot be read is
 * refused, never coerced. `null` back from here is what puts a row in the
 * exceptions list rather than a zero in the ledger.
 */

export type NumberFormat = "european" | "anglo" | "auto";
export type DateFormat = "dmy_dot" | "dmy_slash" | "iso" | "auto";

/** The sign the ledger wants, against the sign the report posts with. */
export type SignConvention = "as_posted" | "invert";

const TRAILING_MINUS = /^(.*?)\s*-$/;
const TRAILING_CREDIT = /^(.*?)\s*(CR|Η|H)$/i;

/**
 * «1.234,56» → 1234.56, «1,234.56» → 1234.56, «1234,5» → 1234.5.
 *
 * `auto` decides by the last separator: whichever of `.` and `,` comes last
 * is the decimal point, and a string with only one of them and exactly three
 * digits behind it is read as a thousands separator, because «1.234» is a
 * thousand two hundred and thirty-four on every Greek desk in the building.
 */
export function parseAmount(raw: string | number | null, format: NumberFormat): number | null {
  if (raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  let text = raw.trim();
  if (text === "") return null;

  let negative = false;
  const credit = TRAILING_CREDIT.exec(text);
  if (credit) {
    negative = true;
    text = credit[1].trim();
  }
  const trailing = TRAILING_MINUS.exec(text);
  if (trailing) {
    negative = true;
    text = trailing[1].trim();
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  }
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = !negative;
    text = text.slice(1, -1).trim();
  }

  // The currency is EUR everywhere (CAPEX-01 §12); a symbol or a code in the
  // cell is decoration and is dropped, not parsed.
  text = text.replace(/[€\s ]/g, "").replace(/EUR$/i, "");
  if (text === "" || !/^[\d.,]+$/.test(text)) return null;

  const decimal = decimalSeparator(text, format);
  const cleaned =
    decimal === null
      ? text.replace(/[.,]/g, "")
      : text
          .split("")
          .filter((ch) => ch !== (decimal === "," ? "." : ","))
          .join("")
          .replace(",", ".");

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function decimalSeparator(text: string, format: NumberFormat): "." | "," | null {
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  if (lastDot < 0 && lastComma < 0) return null;

  if (format === "european") return lastComma >= 0 ? "," : null;
  if (format === "anglo") return lastDot >= 0 ? "." : null;

  if (lastDot >= 0 && lastComma >= 0) return lastDot > lastComma ? "." : ",";
  const separator = lastDot >= 0 ? "." : ",";
  const digitsAfter = text.length - (lastDot >= 0 ? lastDot : lastComma) - 1;
  // One separator with three digits behind it is a thousands separator.
  return digitsAfter === 3 ? null : (separator as "." | ",");
}

const DMY_DOT = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/;
const DMY_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})/;

/** «31.03.2026», «31/03/2026», «2026-03-31» → «2026-03-31». */
export function parseDate(raw: string | Date | null, format: DateFormat): string | null {
  if (raw === null) return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  }
  const text = raw.trim();
  if (text === "") return null;

  const tries: DateFormat[] = format === "auto" ? ["iso", "dmy_dot", "dmy_slash"] : [format];
  for (const attempt of tries) {
    const iso = tryDate(text, attempt);
    if (iso) return iso;
  }
  // A profile that names one format still reads the other two rather than
  // rejecting a file somebody exported with a different locale.
  for (const attempt of ["iso", "dmy_dot", "dmy_slash"] as const) {
    const iso = tryDate(text, attempt);
    if (iso) return iso;
  }
  return null;
}

function tryDate(text: string, format: DateFormat): string | null {
  if (format === "iso") {
    const match = ISO.exec(text);
    return match ? assemble(Number(match[1]), Number(match[2]), Number(match[3])) : null;
  }
  const pattern = format === "dmy_dot" ? DMY_DOT : DMY_SLASH;
  const match = pattern.exec(text);
  if (!match) return null;
  const year = Number(match[3]);
  return assemble(year < 100 ? 2000 + year : year, Number(match[2]), Number(match[1]));
}

function assemble(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * RULE (CAPEX-01 §12): a credit is negative. FBL1N posts a vendor invoice as
 * a credit on the vendor account, so the amount arrives with the sign the
 * ledger does not want and the profile says `invert`; KSB1 and ME2N post
 * spend and commitment as debits and say `as_posted`.
 */
export function applySign(amount: number, convention: SignConvention): number {
  const signed = convention === "invert" ? -amount : amount;
  // -0 is a number Postgres stores and a person reads as a minus sign.
  return signed === 0 ? 0 : signed;
}

/** YYYY-MM, the accounting period an extract belongs to. */
export function isPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** The last day of a YYYY-MM period, as an ISO date. */
export function periodEnd(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** The first day of a YYYY-MM period, as an ISO date. */
export function periodStart(period: string): string {
  return `${period}-01`;
}
