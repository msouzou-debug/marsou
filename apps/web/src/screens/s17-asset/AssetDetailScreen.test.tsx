import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { nicosiaToday, type AssetDetail, type Condition } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { AssetDetailScreen } from "./AssetDetailScreen";

/**
 * Owner UAT 25/11/2026, «asset condition: a change does not take effect».
 * It did take effect; the dropdown went back to «A» after saving and the
 * page said nothing. Through the real `useAsset` and a fake proxy.
 */
function assetWith(condition: Condition | null, assessedAt: string | null): AssetDetail {
  return {
    id: "asset-1",
    orgUnitId: "nicosia-general",
    areaId: "area-1",
    tag: "NGH-HVAC-0001",
    nameEl: "Κλιματιστικό οροφής",
    assetClass: "HVAC",
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
    condition,
    conditionAssessedAt: assessedAt,
    parentAssetId: null,
    servesAreaIds: [],
    system: null,
    costCentre: null,
    sapAssetNo: null,
    sapAssetClass: "111042",
    status: "IN_SERVICE",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
    areaNameEl: "Θάλαμος 214",
    buildingCode: "NGH-A",
    floorCode: "2",
    orgUnitNameEl: "Νοσοκομείο Λευκωσίας",
    sapAssetClassNameEl: "Κλιματισμός",
    sapAssetClassNameEn: "Air-conditioning",
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
  } as AssetDetail;
}

let asset: AssetDetail;
let posts: { url: string; body: Record<string, unknown> }[];
let assetReads: number;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  asset = assetWith("C", "2026-01-10");
  posts = [];
  assetReads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET" && url === "/api/proxy/assets/asset-1") {
        assetReads += 1;
        return json(asset);
      }
      if (init?.method === "POST" && url === "/api/proxy/assets/asset-1/condition") {
        const body = JSON.parse(String(init.body));
        posts.push({ url, body });
        asset = assetWith(body.condition, body.assessedAt);
        return json(asset);
      }
      return json({}, 404);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  renderWithIntl(
    <QueryClientProvider client={client}>
      <AssetDetailScreen assetId="asset-1" roles={["estates_head"]} noPermission={<div />} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

async function conditionForm() {
  const title = await screen.findByText("Καταγραφή κατάστασης");
  return within(title.closest("form")!);
}

describe("AssetDetailScreen — recording the physical condition", () => {
  it("starts on the asset's own condition and on today", async () => {
    renderScreen();
    const form = await conditionForm();
    expect(form.getByLabelText("Φυσική κατάσταση")).toHaveValue("C");
    expect(form.getByLabelText("Ημερομηνία αξιολόγησης")).toHaveValue(nicosiaToday());
  });

  it("stays on the saved value, confirms it, and reads the asset and its lists again", async () => {
    const user = userEvent.setup();
    const { invalidate } = renderScreen();
    const form = await conditionForm();
    await user.selectOptions(form.getByLabelText("Φυσική κατάσταση"), "D");
    await user.type(form.getByLabelText("Σημείωση"), "Διάβρωση στο πλαίσιο");
    const readsBefore = assetReads;
    await user.click(form.getByRole("button", { name: "Καταγραφή" }));

    expect(await form.findByRole("status")).toHaveTextContent("Η φυσική κατάσταση καταγράφηκε.");
    expect(posts).toEqual([
      {
        url: "/api/proxy/assets/asset-1/condition",
        body: { condition: "D", assessedAt: nicosiaToday(), noteEl: "Διάβρωση στο πλαίσιο" },
      },
    ]);
    // The dropdown stays on «D», not back on «A»; the note is spent.
    expect(form.getByLabelText("Φυσική κατάσταση")).toHaveValue("D");
    expect(form.getByLabelText("Σημείωση")).toHaveValue("");
    // No stale cache: the asset and every asset list are invalidated, and
    // the asset is read again.
    await waitFor(() => expect(assetReads).toBeGreaterThan(readsBefore));
    const keys = invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    expect(keys).toEqual(expect.arrayContaining(['["asset","asset-1"]', '["assets"]', '["assets-for-unit"]']));

    // Touching the form again puts the confirmation away.
    await user.selectOptions(form.getByLabelText("Φυσική κατάσταση"), "E");
    expect(form.queryByRole("status")).not.toBeInTheDocument();
  });

  it("starts on «A» for an asset nobody has assessed", async () => {
    asset = assetWith(null, null);
    renderScreen();
    const form = await conditionForm();
    expect(form.getByLabelText("Φυσική κατάσταση")).toHaveValue("A");
  });
});
