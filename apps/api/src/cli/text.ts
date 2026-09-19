/**
 * Folding Greek text so two spellings of the same thing compare equal.
 *
 * The table is the same one `ecapital.normalise` uses in
 * 0002_m1_projects.sql, for the same reason: `lower()` folds only ASCII
 * unless the database's LC_CTYPE knows Greek, and the natural key of the
 * import (CAPEX-03 §2 col E: unit + normalised title) has to mean the same
 * thing in TypeScript as it does in SQL.
 */
const GREEK_FROM = "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰς";
const GREEK_TO = "αβγδεζηθικλμνξοπρστυφχψωαεηιουωιυαεηιουωιυιυσ";
const FOLD = new Map([...GREEK_FROM].map((ch, i) => [ch, GREEK_TO[i]]));

/** Accents off, capitals down, final sigma to plain sigma. */
export function fold(value: string): string {
  return [...value.toLowerCase()].map((ch) => FOLD.get(ch) ?? FOLD.get(ch.toUpperCase()) ?? ch).join("");
}

/** Runs of whitespace, including the non-breaking space Excel likes, to one space. */
export function collapse(value: string): string {
  return value.replace(/[\s ]+/g, " ").trim();
}

/** What the natural key compares: folded, collapsed, no trailing punctuation. */
export function normaliseTitle(value: string): string {
  return fold(collapse(value)).replace(/[.,;:·]+$/g, "").trim();
}

/** Folded and collapsed, for comparing a cell against a value in the profile. */
export function key(value: string): string {
  return fold(collapse(value));
}

/** €1.234.567,89 the way the report prints money, to the cent. */
export function formatEur(amount: number): string {
  return `${new Intl.NumberFormat("el-GR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)} €`;
}

/** Money to the cent as an integer of cents, so sums do not drift. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}
