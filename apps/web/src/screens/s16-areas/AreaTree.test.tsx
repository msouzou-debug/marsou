import { describe, expect, it, vi } from "vitest";
import type { AreaTree } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { AreaTreeView } from "./AreaTreeView";

// The seeded Nicosia building, cut down: one building, two floors, three
// areas — enough to prove the nesting and the per-area facts.
const tree: AreaTree = {
  orgUnitId: "nicosia-general",
  buildings: [
    {
      id: "b1",
      orgUnitId: "nicosia-general",
      code: "NGH-A",
      nameEl: "Κτίριο Α — Κεντρική Πτέρυγα",
      grossAreaM2: 18400,
      yearBuilt: 2006,
      storeys: 2,
      floors: [
        {
          id: "f0",
          buildingId: "b1",
          code: "00",
          nameEl: "Ισόγειο",
          level: 0,
          areas: [
            {
              id: "a1",
              floorId: "f0",
              code: "OPD-01",
              nameEl: "Εξωτερικά Ιατρεία",
              areaType: "OPD",
              patientRiskGroup: "MEDIUM",
              costCentre: "CC-NGH-OPD",
              beds: null,
            },
          ],
        },
        {
          id: "f1",
          buildingId: "b1",
          code: "01",
          nameEl: "Πρώτος όροφος",
          level: 1,
          areas: [
            {
              id: "a2",
              floorId: "f1",
              code: "ICU-01",
              nameEl: "Μονάδα Εντατικής Θεραπείας",
              areaType: "ICU",
              patientRiskGroup: "HIGHEST",
              costCentre: "CC-NGH-ICU",
              beds: 8,
            },
            {
              id: "a3",
              floorId: "f1",
              code: "WRD-01",
              nameEl: "Θάλαμος Α1",
              areaType: "WARD",
              patientRiskGroup: "HIGH",
              costCentre: "CC-NGH-WRD",
              beds: 24,
            },
          ],
        },
      ],
    },
  ],
};

describe("AreaTreeView", () => {
  it("nests areas under their floor and floors under their building", () => {
    const { container } = renderWithIntl(<AreaTreeView tree={tree} />, { locale: "el" });

    const buildings = container.querySelectorAll(":scope > ul > li");
    expect(buildings).toHaveLength(1);
    const floors = buildings[0]!.querySelectorAll(":scope > ul > li");
    expect(floors).toHaveLength(2);
    expect(floors[0]!.querySelectorAll(":scope > ul > li")).toHaveLength(1);
    expect(floors[1]!.querySelectorAll(":scope > ul > li")).toHaveLength(2);

    expect(container.textContent).toContain("Κτίριο Α — Κεντρική Πτέρυγα");
    expect(container.textContent).toContain("Ισόγειο");
    expect(container.textContent).toContain("Θάλαμος Α1");
  });

  it("names the type and the risk group of every area, and the beds where there are any", () => {
    const { container } = renderWithIntl(<AreaTreeView tree={tree} />, { locale: "el" });
    const text = container.textContent ?? "";
    expect(text).toContain("Μονάδα εντατικής θεραπείας");
    expect(text).toContain("ομάδα κινδύνου: πολύ υψηλή");
    expect(text).toContain("8 κλίνες");
    expect(text).toContain("24 κλίνες");
    // The outpatients room has no beds, so nothing is invented for it.
    expect(text).toContain("Εξωτερικά ιατρεία");
    expect(text).not.toContain("0 κλίνες");
  });

  // RULE: the risk group is ICRA data and stays plain text until M3 — no
  // chip, no colour class. Colouring the band alone would read as a verdict
  // the system has not reached yet.
  it("shows the risk group as plain text, with no status colour", () => {
    const { container } = renderWithIntl(<AreaTreeView tree={tree} />, { locale: "el" });
    const markup = container.innerHTML;
    expect(markup).not.toContain("k-red");
    expect(markup).not.toContain("k-amber");
    expect(markup).not.toContain("k-purple");
  });

  it("uses «Κτίριο» as the level label, never «Νοσοκομείο»", () => {
    const { container } = renderWithIntl(<AreaTreeView tree={tree} />, { locale: "el" });
    expect(container.querySelector(".eyebrow")?.textContent).toBe("Κτίριο");
    expect(container.textContent).not.toContain("Νοσοκομείο");
  });
});

describe("loadAreaTree", () => {
  // Each case resets the module registry so `load-tree` and the `ApiError` it
  // compares against come from the same freshly-loaded module — two copies of
  // the class would fail `instanceof` for reasons that have nothing to do
  // with the rule under test.
  async function loadWith(get: (client: typeof import("@/data/client")) => unknown) {
    vi.resetModules();
    vi.doMock("@/data/server", async () => {
      const client = await import("@/data/client");
      return { serverApi: async () => ({ token: "t", get: () => get(client) }) };
    });
    const { loadAreaTree } = await import("./load-tree");
    return loadAreaTree("larnaca-general");
  }

  const rejectWith = (status: number, key?: string) => (client: typeof import("@/data/client")) =>
    Promise.reject(new client.ApiError("from the API", status, key));

  // RULE (ADR-0010): the API answers 404 for a unit outside the caller's
  // access *and* for a unit that does not exist, so the screen shows one
  // state for both. Anything else would leak which units exist.
  it("turns the API's 404 into the no-permission state", async () => {
    expect(await loadWith(rejectWith(404, "errors.unitNotFound"))).toEqual({ kind: "noPermission" });
  });

  it("does not tell a missing unit apart from one that is not yours", async () => {
    const missing = await loadWith(rejectWith(404, "errors.routeNotFound"));
    const notYours = await loadWith(rejectWith(404, "errors.unitNotFound"));
    expect(missing).toEqual(notYours);
  });

  it("keeps a server failure as an error, not as a refusal", async () => {
    expect(await loadWith(rejectWith(500))).toEqual({ kind: "error" });
  });

  it("hands back the tree when the API answers", async () => {
    expect(await loadWith(() => Promise.resolve(tree))).toEqual({ kind: "tree", tree });
  });

  it("is a refusal, not an error, when there is no session at all", async () => {
    vi.resetModules();
    vi.doMock("@/data/server", () => ({ serverApi: async () => null }));
    const { loadAreaTree } = await import("./load-tree");
    expect(await loadAreaTree("nicosia-general")).toEqual({ kind: "noPermission" });
  });
});
