import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { AssetDetail, type AssetDetailProps } from "./AssetDetail";

const BASE_ASSET = {
  id: "asset-1",
  orgUnitId: "nicosia-general",
  areaId: "area-1",
  tag: "NGH-HVAC-0001",
  nameEl: "Κλιματιστικό οροφής",
  assetClass: "HVAC" as const,
  manufacturer: "Daikin",
  model: "VRV IV",
  serialNo: "SN-001",
  installedDate: "2020-01-15",
  commissionedDate: "2020-02-01",
  sourceProjectId: null,
  sourceContractId: null,
  capitalCost: 12000,
  warrantyEnd: "2025-01-15",
  expectedLifeYears: 15,
  replacementYear: 2035,
  replacementCostEst: 14000,
  criticality: 2,
  condition: "C" as const,
  conditionAssessedAt: "2026-01-10",
  parentAssetId: null,
  servesAreaIds: [],
  system: null,
  costCentre: null,
  sapAssetNo: null,
  status: "IN_SERVICE" as const,
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2026-01-10T00:00:00.000Z",
  areaNameEl: "Θάλαμος 214",
  buildingCode: "NGH-A",
  floorCode: "2",
  orgUnitNameEl: "Νοσοκομείο Λευκωσίας",
  sourceProjectCode: null,
  sourceContractRef: null,
  parentTag: null,
  children: [],
  documents: [],
  readings: [],
  history: [],
  wholeLife: {
    capitalCost: 12000,
    maintenanceToDate: 1500,
    replacementCostEst: 14000,
    replacementYear: 2035,
    ageYears: 6,
    remainingLifeYears: 9,
  },
  openPermits: [],
  openDefects: 0,
};

const BASE_PROPS: AssetDetailProps = {
  asset: BASE_ASSET,
  state: "default",
  assetUrl: "https://ecapital.test/a/NGH-HVAC-0001",
  noPermission: <div />,
  canWrite: true,
  canRecordCondition: true,
  canUploadDocuments: true,
  conditionForm: { condition: "A", assessedAt: "2026-01-10", noteEl: "" },
  onConditionFormChange: vi.fn(),
  conditionSaving: false,
  onSubmitCondition: vi.fn(),
  readingForm: { takenAt: "2026-01-10", readingType: "", value: "", unit: "" },
  onReadingFormChange: vi.fn(),
  readingSaving: false,
  onSubmitReading: vi.fn(),
  documentSheetOpen: false,
  onOpenDocumentSheet: vi.fn(),
  onCloseDocumentSheet: vi.fn(),
  documentForm: { kind: "OM_MANUAL", titleEl: "", file: null },
  onDocumentFormChange: vi.fn(),
  documentUploading: false,
  onSubmitDocument: vi.fn(),
};

describe("AssetDetail", () => {
  it("shows the breadcrumb ending on the asset's own name", () => {
    renderWithIntl(<AssetDetail {...BASE_PROPS} />);
    expect(screen.getByRole("link", { name: /Κλιματιστικό οροφής$/ })).toBeInTheDocument();
    expect(screen.getByText("Θάλαμος 214")).toBeInTheDocument();
  });

  it("renders the whole-life CostBar with the three glossary labels", () => {
    renderWithIntl(<AssetDetail {...BASE_PROPS} />);
    expect(screen.getByText("Κόστος κτήσης")).toBeInTheDocument();
    expect(screen.getByText("Συντήρηση έως σήμερα")).toBeInTheDocument();
    expect(screen.getByText("Εκτίμηση αντικατάστασης")).toBeInTheDocument();
  });

  // RULE (contract AssetDetail.wholeLife / build brief item 3): a null
  // capitalCost renders «—» facts, never a CostBar forced to a fabricated 0.
  it("renders dash facts, never a CostBar, when capitalCost is null", () => {
    const asset = { ...BASE_ASSET, wholeLife: { ...BASE_ASSET.wholeLife, capitalCost: null } };
    renderWithIntl(<AssetDetail {...BASE_PROPS} asset={asset} />);
    expect(screen.getByText("Δεν έχει καταχωριστεί κόστος κτήσης για αυτό το πάγιο.")).toBeInTheDocument();
    expect(screen.queryByText("Κόστος κτήσης")).not.toBeInTheDocument();
  });

  // RULE (auth/roles canRecordAssetCondition): hidden, not disabled, for a role that cannot record it.
  it("hides the condition and reading forms for a role that cannot record a condition", () => {
    renderWithIntl(<AssetDetail {...BASE_PROPS} canRecordCondition={false} />);
    expect(screen.queryByText("Καταγραφή κατάστασης")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Τύπος μέτρησης")).not.toBeInTheDocument();
  });

  it("shows a technician the condition form even when they cannot edit the record", () => {
    renderWithIntl(<AssetDetail {...BASE_PROPS} canWrite={false} canRecordCondition={true} />);
    expect(screen.getByText("Καταγραφή κατάστασης")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Επεξεργασία" })).not.toBeInTheDocument();
  });

  it("shows the noPermission node instead of the record", () => {
    renderWithIntl(<AssetDetail {...BASE_PROPS} state="noPermission" noPermission={<p>no-permission-marker</p>} />);
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
  });
});
