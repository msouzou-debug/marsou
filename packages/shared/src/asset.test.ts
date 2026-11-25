import { describe, expect, it } from "vitest";
import {
  AssetClass,
  AssetListQuery,
  AssetWrite,
  SAP_ASSET_CLASS_BY_ASSET_CLASS,
  assetDateIssues,
  defaultSapAssetClass,
  nicosiaToday,
} from "./asset";

const TODAY = "2026-11-25";

describe("assetDateIssues (UAT 25/11/2026)", () => {
  it("accepts dates in order, and no dates at all", () => {
    expect(assetDateIssues({}, TODAY)).toEqual([]);
    expect(
      assetDateIssues(
        { installedDate: "2024-03-01", commissionedDate: "2024-03-01", warrantyEnd: "2026-03-01", replacementYear: 2024 },
        TODAY,
      ),
    ).toEqual([]);
  });

  it("refuses a commissioning before the installation", () => {
    expect(assetDateIssues({ installedDate: "2024-03-10", commissionedDate: "2024-03-01" }, TODAY)).toEqual([
      { field: "commissionedDate", rule: "commissionedBeforeInstalled" },
    ]);
  });

  it("refuses a warranty that ends before the installation, or before the commissioning", () => {
    expect(assetDateIssues({ installedDate: "2024-03-10", warrantyEnd: "2024-03-01" }, TODAY)).toEqual([
      { field: "warrantyEnd", rule: "warrantyBeforeInstalled" },
    ]);
    expect(assetDateIssues({ commissionedDate: "2024-03-10", warrantyEnd: "2024-03-01" }, TODAY)).toEqual([
      { field: "warrantyEnd", rule: "warrantyBeforeCommissioned" },
    ]);
  });

  it("refuses an installation or a commissioning after today, and takes today itself", () => {
    expect(assetDateIssues({ installedDate: TODAY, commissionedDate: TODAY }, TODAY)).toEqual([]);
    expect(assetDateIssues({ installedDate: "2026-11-26", commissionedDate: "2026-12-01" }, TODAY)).toEqual([
      { field: "installedDate", rule: "installedInFuture" },
      { field: "commissionedDate", rule: "commissionedInFuture" },
    ]);
    // A warranty runs into the future; that is what a warranty is for.
    expect(assetDateIssues({ installedDate: "2026-01-01", warrantyEnd: "2031-01-01" }, TODAY)).toEqual([]);
  });

  it("refuses a replacement year before the year of installation", () => {
    expect(assetDateIssues({ installedDate: "2020-06-01", replacementYear: 2019 }, TODAY)).toEqual([
      { field: "replacementYear", rule: "replacementBeforeInstalled" },
    ]);
    expect(assetDateIssues({ installedDate: "2020-06-01", replacementYear: 2020 }, TODAY)).toEqual([]);
  });

  it("leaves a value that is not a calendar day to the schema", () => {
    expect(assetDateIssues({ installedDate: "not a date", commissionedDate: "2024-01-01" }, TODAY)).toEqual([]);
  });
});

describe("nicosiaToday", () => {
  it("reads the day in Cyprus, not in UTC", () => {
    // 23:30 UTC on 31/12 is already 01:30 on 01/01 in Nicosia.
    expect(nicosiaToday(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(nicosiaToday(new Date("2026-11-25T10:00:00Z"))).toBe("2026-11-25");
  });
});

describe("AssetWrite", () => {
  const base = { orgUnitId: "nicosia-general", nameEl: "Κλιματιστική μονάδα", assetClass: "HVAC", criticality: 3 };

  it("carries the database's limits, so a bad field is named before the insert", () => {
    expect(AssetWrite.safeParse(base).success).toBe(true);
    for (const bad of [
      { nameEl: " Α " },
      { expectedLifeYears: 0 },
      { expectedLifeYears: 121 },
      { replacementYear: 1899 },
      { capitalCost: -1 },
      { replacementCostEst: -0.01 },
      { installedDate: "25/11/2026" },
      { warrantyEnd: "2026-02-30" },
    ]) {
      const parsed = AssetWrite.safeParse({ ...base, ...bad });
      expect(parsed.success, JSON.stringify(bad)).toBe(false);
      expect(parsed.error?.issues[0]?.path[0]).toBe(Object.keys(bad)[0]);
    }
  });

  it("trims the name it stores", () => {
    expect(AssetWrite.parse({ ...base, nameEl: "  Αντλία  " }).nameEl).toBe("Αντλία");
  });
});

describe("the default SAP asset class (owner decision 25/11/2026)", () => {
  it("maps every eCapital class, and OTHER to none", () => {
    expect(Object.keys(SAP_ASSET_CLASS_BY_ASSET_CLASS).sort()).toEqual([...AssetClass.options].sort());
    expect(defaultSapAssetClass("BUILDING_FABRIC")).toBe("111020");
    expect(defaultSapAssetClass("HVAC")).toBe("111042");
    expect(defaultSapAssetClass("ELECTRICAL")).toBe("111062");
    expect(defaultSapAssetClass("MEDICAL_GAS")).toBe("111062");
    expect(defaultSapAssetClass("WATER")).toBe("111062");
    expect(defaultSapAssetClass("FIRE")).toBe("111058");
    expect(defaultSapAssetClass("LIFT")).toBe("111040");
    expect(defaultSapAssetClass("BIOMEDICAL")).toBe("111030");
    expect(defaultSapAssetClass("IT")).toBe("111050");
    expect(defaultSapAssetClass("OTHER")).toBeNull();
  });

  it("filters the register by a six-digit code or NONE, and nothing else", () => {
    expect(AssetListQuery.parse({ sapAssetClass: "111042" }).sapAssetClass).toBe("111042");
    expect(AssetListQuery.parse({ sapAssetClass: "NONE" }).sapAssetClass).toBe("NONE");
    expect(AssetListQuery.safeParse({ sapAssetClass: "11104" }).success).toBe(false);
  });
});
