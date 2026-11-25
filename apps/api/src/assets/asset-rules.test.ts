import { AssetWrite } from "@ecapital/shared";
import { describe, expect, it } from "vitest";
import { AppError } from "../common/errors";
import { I18nService } from "../common/i18n.service";
import el from "../i18n/el.json";
import {
  assetBodyError,
  assetDateError,
  checkViolationKey,
  conditionAssessedAt,
} from "./asset-rules";

const i18n = new I18nService();
const base = { orgUnitId: "nicosia-general", nameEl: "Κλιματιστική μονάδα", assetClass: "HVAC", criticality: 3 };

function refusal(body: Record<string, unknown>): AppError {
  const parsed = AssetWrite.safeParse(body);
  if (parsed.success) throw new Error("expected a refusal");
  return assetBodyError(parsed.error, body);
}

function caught(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError");
}

describe("assetBodyError (UAT 25/11/2026)", () => {
  it("says the name is a letter short, not that the asset is incomplete", () => {
    expect(refusal({ ...base, nameEl: "Α" }).messageKey).toBe("errors.assetNameLength");
  });

  it("states the range of the life, the year and the money", () => {
    expect(refusal({ ...base, expectedLifeYears: 0 }).messageKey).toBe("errors.assetExpectedLifeRange");
    expect(refusal({ ...base, replacementYear: 2500 }).messageKey).toBe("errors.assetReplacementYearRange");
    expect(refusal({ ...base, capitalCost: -5 }).messageKey).toBe("errors.assetCapitalCostNegative");
    expect(refusal({ ...base, replacementCostEst: -5 }).messageKey).toBe("errors.assetReplacementCostNegative");
  });

  it("names a missing field, and a wrong one, by its label in the caller's language", () => {
    const missing = refusal({ nameEl: "Αντλία", assetClass: "HVAC", criticality: 3 });
    expect(missing.messageKey).toBe("errors.assetFieldNeeded");
    expect(i18n.translate(missing.messageKey, "el", missing.params)).toContain("«Μονάδα»");

    const wrong = refusal({ ...base, system: "STEAMPUNK" });
    expect(wrong.messageKey).toBe("errors.assetFieldNotValid");
    expect(i18n.translate(wrong.messageKey, "en", wrong.params)).toContain('"System"');

    const date = refusal({ ...base, installedDate: "25/11/2026" });
    expect(date.messageKey).toBe("errors.assetDateNotValid");
    expect(i18n.translate(date.messageKey, "el", date.params)).toContain("«Ημερομηνία εγκατάστασης»");
  });

  it("falls back to the general sentence for a body that is not an object", () => {
    expect(refusal("nonsense" as never).messageKey).toBe("errors.assetNotValid");
  });

  it("turns a date rule carried on a custom issue into its own sentence", () => {
    const parsed = AssetWrite.superRefine((_value, ctx) => {
      ctx.addIssue({ code: "custom", path: ["commissionedDate"], message: "commissionedBeforeInstalled" });
    }).safeParse(base);
    expect(parsed.success).toBe(false);
    expect(assetBodyError(parsed.error!, base).messageKey).toBe("errors.assetCommissionedBeforeInstalled");
    expect(assetDateError({ field: "warrantyEnd", rule: "warrantyBeforeInstalled" }).messageKey).toBe(
      "errors.assetWarrantyBeforeInstalled",
    );
  });

  it("has a label for every field of the contract", () => {
    for (const field of Object.keys(AssetWrite.shape)) {
      expect((el.assetField as Record<string, string>)[field], field).toBeTruthy();
    }
  });
});

describe("checkViolationKey", () => {
  it("maps each CHECK on the asset to its own sentence, and an unnamed one to the route's", () => {
    expect(checkViolationKey("asset_name_length", "errors.assetNotValid")).toBe("errors.assetNameLength");
    expect(checkViolationKey("asset_expected_life_positive", "errors.assetNotValid")).toBe(
      "errors.assetExpectedLifeRange",
    );
    expect(checkViolationKey("asset_replacement_year_sane", "errors.assetNotValid")).toBe(
      "errors.assetReplacementYearRange",
    );
    expect(checkViolationKey(undefined, "errors.assetConditionNotValid")).toBe("errors.assetConditionNotValid");
    expect(checkViolationKey("something_else", "errors.assetNotValid")).toBe("errors.assetNotValid");
  });

  it("only names sentences that exist in Greek", () => {
    for (const constraint of [
      "asset_criticality_range",
      "asset_condition_band",
      "asset_condition_assessed",
      "asset_capital_cost_non_negative",
      "asset_replacement_cost_non_negative",
      "asset_expected_life_positive",
      "asset_replacement_year_sane",
      "asset_not_its_own_parent",
      "asset_serves_areas_are_uuids",
      "asset_name_length",
      "asset_reading_type_length",
      "asset_reading_unit_length",
    ]) {
      const key = checkViolationKey(constraint, "none");
      expect(key, constraint).not.toBe("none");
      expect(i18n.translate(key, "el"), constraint).not.toBe(key);
    }
  });
});

describe("conditionAssessedAt (UAT 25/11/2026)", () => {
  const today = "2026-11-25";
  const now = new Date("2026-11-25T09:00:00Z");

  it("takes the calendar day the form's date field sends", () => {
    expect(conditionAssessedAt("2026-11-20", today, now)).toBe("2026-11-20T00:00:00.000Z");
  });

  it("reads today, and no date, as now", () => {
    expect(conditionAssessedAt(today, today, now)).toBeNull();
    expect(conditionAssessedAt(undefined, today, now)).toBeNull();
  });

  it("still takes a full timestamp", () => {
    expect(conditionAssessedAt("2026-11-24T08:15:00Z", today, now)).toBe("2026-11-24T08:15:00.000Z");
  });

  it("refuses a day or a moment after today with a sentence about the date, not the band", () => {
    expect(caught(() => conditionAssessedAt("2026-11-26", today, now)).messageKey).toBe(
      "errors.assetConditionDateInFuture",
    );
    expect(caught(() => conditionAssessedAt("2026-11-26T09:00:00Z", today, now)).messageKey).toBe(
      "errors.assetConditionDateInFuture",
    );
  });
});
