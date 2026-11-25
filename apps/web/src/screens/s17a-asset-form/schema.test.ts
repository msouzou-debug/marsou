import { describe, expect, it } from "vitest";
import { nicosiaToday } from "@ecapital/shared";
import { AssetCreateFormSchema, AssetEditFormSchema, type AssetFormValues } from "./schema";

// UAT 25/11/2026: the form says what the database and the API would refuse,
// under the field it is about.
const VALID: AssetFormValues = {
  nameEl: "Κλιματιστική μονάδα",
  assetClass: "HVAC",
  areaId: null,
  parentAssetId: null,
  manufacturer: null,
  model: null,
  serialNo: null,
  installedDate: "2024-03-01",
  commissionedDate: "2024-03-10",
  sourceProjectId: null,
  sourceContractId: null,
  capitalCost: 1000,
  warrantyEnd: "2026-03-10",
  expectedLifeYears: 20,
  replacementYear: 2044,
  replacementCostEst: 1200,
  criticality: 3,
  system: null,
  servesAreaIds: [],
};

function messages(values: Partial<AssetFormValues>): Record<string, string> {
  const parsed = AssetEditFormSchema.safeParse({ ...VALID, ...values });
  if (parsed.success) return {};
  // The first issue per field, as `zodResolver` shows it.
  const first: Record<string, string> = {};
  for (const issue of parsed.error.issues) first[String(issue.path[0])] ??= issue.message;
  return first;
}

function tomorrow(): string {
  const at = new Date(`${nicosiaToday()}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

describe("S17a schema", () => {
  it("accepts an asset whose dates and numbers are in range", () => {
    expect(AssetEditFormSchema.safeParse(VALID).success).toBe(true);
    expect(AssetCreateFormSchema.safeParse({ ...VALID, orgUnitId: "unit-1" }).success).toBe(true);
  });

  it("carries the database's limits, each with its own message", () => {
    expect(messages({ nameEl: "Α" })).toEqual({ nameEl: "screens.s17a.errors.nameLength" });
    expect(messages({ nameEl: "  " })).toEqual({ nameEl: "forms.required" });
    expect(messages({ expectedLifeYears: 0 })).toEqual({ expectedLifeYears: "screens.s17a.errors.expectedLifeRange" });
    expect(messages({ expectedLifeYears: 121 })).toEqual({ expectedLifeYears: "screens.s17a.errors.expectedLifeRange" });
    expect(messages({ replacementYear: 1899 })).toEqual({ replacementYear: "screens.s17a.errors.replacementYearRange" });
    expect(messages({ capitalCost: -1 })).toEqual({ capitalCost: "screens.s17a.errors.costNonNegative" });
    expect(messages({ replacementCostEst: -1 })).toEqual({ replacementCostEst: "screens.s17a.errors.costNonNegative" });
  });

  it("keeps the dates in order", () => {
    expect(messages({ commissionedDate: "2024-02-01", warrantyEnd: null })).toEqual({
      commissionedDate: "screens.s17a.errors.commissionedBeforeInstalled",
    });
    expect(messages({ warrantyEnd: "2024-03-05" })).toEqual({
      warrantyEnd: "screens.s17a.errors.warrantyBeforeCommissioned",
    });
    expect(messages({ warrantyEnd: "2024-02-01" })).toEqual({
      warrantyEnd: "screens.s17a.errors.warrantyBeforeInstalled",
    });
    expect(messages({ replacementYear: 2023 })).toEqual({
      replacementYear: "screens.s17a.errors.replacementBeforeInstalled",
    });
  });

  it("refuses an installation or commissioning after today", () => {
    const next = tomorrow();
    expect(messages({ installedDate: next, commissionedDate: null, warrantyEnd: null, replacementYear: null })).toEqual({
      installedDate: "screens.s17a.errors.installedInFuture",
    });
    expect(messages({ commissionedDate: next, warrantyEnd: null })).toEqual({
      commissionedDate: "screens.s17a.errors.commissionedInFuture",
    });
  });
});
