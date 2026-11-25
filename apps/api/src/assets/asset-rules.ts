/**
 * M4 — which sentence an asset write that the rules refused gets.
 *
 * UAT 25/11/2026: every refusal on the register came back as the one
 * «details are incomplete» sentence, whether the name was a letter short,
 * the life was 0 years or a CHECK in 0017 said no. A person cannot fix what
 * they are not told, so each failure is named here:
 *
 *  - a zod failure names its first field: a sentence of its own where the
 *    field has a rule to state (the name's length, the life's range), else
 *    `errors.assetFieldNeeded` / `errors.assetFieldNotValid` with the field's
 *    label, looked up in the caller's language (`i18n:assetField.<name>`);
 *  - a date rule (`assetDateIssues` in `@ecapital/shared`) has its own key;
 *  - a CHECK constraint the database refused on maps by its name; one with
 *    no name falls back to the route's own sentence.
 *
 * Pure: no database, no request. The service and the controller call it.
 */
import type { AssetDateIssue, AssetDateRule } from "@ecapital/shared";
import type { ZodError } from "zod";
import { AppError } from "../common/errors";

/** The CHECKs on `asset` and `asset_reading` (0017), each with its sentence. */
const CHECK_KEYS: Readonly<Record<string, string>> = {
  asset_criticality_range: "errors.assetCriticalityRange",
  asset_condition_band: "errors.assetConditionNotValid",
  asset_condition_assessed: "errors.assetConditionDateNeeded",
  asset_capital_cost_non_negative: "errors.assetCapitalCostNegative",
  asset_replacement_cost_non_negative: "errors.assetReplacementCostNegative",
  asset_expected_life_positive: "errors.assetExpectedLifeRange",
  asset_replacement_year_sane: "errors.assetReplacementYearRange",
  asset_not_its_own_parent: "errors.assetOwnParent",
  asset_serves_areas_are_uuids: "errors.assetServesAreasNotValid",
  asset_name_length: "errors.assetNameLength",
  asset_reading_type_length: "errors.assetReadingTypeLength",
  asset_reading_unit_length: "errors.assetReadingUnitLength",
};

export function checkViolationKey(constraint: string | undefined, fallback: string): string {
  return (constraint && CHECK_KEYS[constraint]) || fallback;
}

const DATE_RULE_KEYS: Readonly<Record<AssetDateRule, string>> = {
  installedInFuture: "errors.assetInstalledInFuture",
  commissionedInFuture: "errors.assetCommissionedInFuture",
  commissionedBeforeInstalled: "errors.assetCommissionedBeforeInstalled",
  warrantyBeforeInstalled: "errors.assetWarrantyBeforeInstalled",
  warrantyBeforeCommissioned: "errors.assetWarrantyBeforeCommissioned",
  replacementBeforeInstalled: "errors.assetReplacementBeforeInstalled",
};

export function assetDateError(issue: AssetDateIssue): AppError {
  return AppError.badRequest(DATE_RULE_KEYS[issue.rule]);
}

/** A field whose rule is worth a sentence of its own when its value is out of range. */
const RANGE_KEYS: Readonly<Record<string, string>> = {
  nameEl: "errors.assetNameLength",
  expectedLifeYears: "errors.assetExpectedLifeRange",
  replacementYear: "errors.assetReplacementYearRange",
  capitalCost: "errors.assetCapitalCostNegative",
  replacementCostEst: "errors.assetReplacementCostNegative",
  criticality: "errors.assetCriticalityRange",
};

const DATE_FIELDS = new Set(["installedDate", "commissionedDate", "warrantyEnd"]);

/**
 * The first thing wrong with an asset body, as the sentence to send. The
 * body is the one the caller sent, so a field that is missing can be told
 * apart from one that is there and wrong.
 */
export function assetBodyError(error: ZodError, body: unknown): AppError {
  const issue = error.issues[0];
  const field = typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
  if (!issue || !field) return AppError.badRequest("errors.assetNotValid");

  if (issue.code === "custom" && issue.message in DATE_RULE_KEYS) {
    return AppError.badRequest(DATE_RULE_KEYS[issue.message as AssetDateRule]);
  }
  const label = { field: `i18n:assetField.${field}` };
  const sent = body && typeof body === "object" ? (body as Record<string, unknown>)[field] : undefined;
  if (sent === undefined) return AppError.badRequest("errors.assetFieldNeeded", label);
  if ((issue.code === "too_small" || issue.code === "too_big") && RANGE_KEYS[field]) {
    return AppError.badRequest(RANGE_KEYS[field]);
  }
  if (DATE_FIELDS.has(field)) return AppError.badRequest("errors.assetDateNotValid", label);
  return AppError.badRequest("errors.assetFieldNotValid", label);
}

/**
 * R29, UAT 25/11/2026: the condition form's date is an `<input type=date>`,
 * a calendar day, and the route used to take only a full timestamp — so
 * every assessment with a date was refused as «not a band A to E». Both are
 * taken now. Today, or no date, is "now" (the database's clock); an earlier
 * day is stored as 00:00 UTC of that day, which is the same calendar day
 * in Nicosia whichever side of summer time it falls. Neither may be later
 * than today.
 */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function conditionAssessedAt(
  value: string | undefined,
  today: string,
  now: Date,
): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (value > today) throw AppError.badRequest("errors.assetConditionDateInFuture");
    return value === today ? null : `${value}T00:00:00.000Z`;
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) throw AppError.badRequest("errors.assetConditionDateNotValid");
  if (at > now.getTime() + CLOCK_SKEW_MS) {
    throw AppError.badRequest("errors.assetConditionDateInFuture");
  }
  return new Date(at).toISOString();
}
