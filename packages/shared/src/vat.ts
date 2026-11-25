import { z } from "zod";

// ------------------------------------------------------------ VAT (ADR-0038)
// Owner decision, item 23 (25/11/2026): «amounts should be with VAT across
// the tool». ΟΚΥπΥ provides VAT-exempt health services and cannot recover
// input VAT, so the VAT on a contract is a real cost to the project.
//
// The model: a commitment signed excl. VAT (a contract, a variation, a
// payment certificate) stores its NET amount and a VAT RATE. VAT and GROSS
// are computed — in the database as generated columns, and here with the
// same rounding so the screen's live preview says what the database will
// store. Budgets (the approved budget, budget lines, the cash-flow plan) are
// amounts incl. VAT and carry no rate. Budget control compares gross with
// gross.

/** The Cyprus VAT rates a capital contract can carry. */
export const VatRate = z.enum(["STANDARD_19", "REDUCED_9", "REDUCED_5", "ZERO", "EXEMPT"]);
export type VatRate = z.infer<typeof VatRate>;

/** Every rate in the order a select offers them. */
export const VAT_RATES: readonly VatRate[] = VatRate.options;

/**
 * RULE (ADR-0038 §7): Cypriot public works contracts are signed excl. VAT at
 * the standard rate, so a contract nobody gave a rate to carries 19 %.
 */
export const DEFAULT_VAT_RATE: VatRate = "STANDARD_19";

/** The rate as a fraction. ZERO and EXEMPT both charge nothing; they differ in law, not in money. */
export const VAT_RATE_VALUE: Readonly<Record<VatRate, number>> = Object.freeze({
  STANDARD_19: 0.19,
  REDUCED_9: 0.09,
  REDUCED_5: 0.05,
  ZERO: 0,
  EXEMPT: 0,
});

/** The rate in basis points, so the arithmetic below stays in integers. */
const BASIS_POINTS: Readonly<Record<VatRate, number>> = Object.freeze({
  STANDARD_19: 1900,
  REDUCED_9: 900,
  REDUCED_5: 500,
  ZERO: 0,
  EXEMPT: 0,
});

/**
 * Round to the cent, half away from zero — what PostgreSQL's
 * `round(numeric, 2)` does, so a figure computed here and one generated in
 * the database never differ by a cent. `toPrecision(15)` strips the binary
 * noise first (1.005 × 100 is 100.49999999999999 in a double).
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const shifted = Number((Math.abs(value) * 100).toPrecision(15));
  const rounded = (sign * Math.round(shifted)) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** Whole cents of a money figure. */
function centsOf(value: number): number {
  return Math.round(roundMoney(value) * 100);
}

/**
 * The VAT on a net amount at a rate, rounded to the cent half away from
 * zero. Integer arithmetic on cents × basis points, so 0.5 cent is exactly
 * 0.5 and rounds the way the database does. A negative net (an omission
 * variation) gives a negative VAT.
 */
export function vatOf(net: number, rate: VatRate): number {
  const numerator = centsOf(net) * BASIS_POINTS[rate];
  const sign = numerator < 0 ? -1 : 1;
  const cents = sign * Math.round(Math.abs(numerator) / 10_000);
  return cents === 0 ? 0 : cents / 100;
}

/** Net plus its VAT. */
export function grossOf(net: number, rate: VatRate): number {
  return roundMoney(roundMoney(net) + vatOf(net, rate));
}

/** Net, VAT and gross together, the three columns every screen and workbook shows. */
export interface VatBreakdown {
  net: number;
  vat: number;
  gross: number;
}

export function vatBreakdown(net: number, rate: VatRate): VatBreakdown {
  const vat = vatOf(net, rate);
  return { net: roundMoney(net), vat, gross: roundMoney(roundMoney(net) + vat) };
}
