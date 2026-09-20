import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { AreaPicker } from "./AreaPicker";

const TREE = {
  orgUnitId: "unit-1",
  buildings: [
    {
      id: "b1",
      orgUnitId: "unit-1",
      code: "A",
      nameEl: "Κτίριο Α",
      grossAreaM2: null,
      yearBuilt: null,
      storeys: null,
      floors: [
        {
          id: "f1",
          buildingId: "b1",
          code: "1",
          nameEl: "1ος",
          level: 1,
          areas: [
            { id: "a1", floorId: "f1", code: "A101", nameEl: "Χειρουργείο 1", areaType: "THEATRE" as const, patientRiskGroup: "HIGH" as const, costCentre: null, beds: null },
          ],
        },
      ],
    },
  ],
};

describe("AreaPicker", () => {
  it("toggles a direct area on click", async () => {
    const onToggle = vi.fn();
    renderWithIntl(<AreaPicker areaTree={TREE} selectedAreaIds={[]} onToggle={onToggle} />);
    await userEvent.click(screen.getByLabelText(/Χειρουργείο 1/));
    expect(onToggle).toHaveBeenCalledWith("a1");
  });

  it("shows indirect areas with no checkbox — they cannot be un-picked here", () => {
    renderWithIntl(
      <AreaPicker
        areaTree={TREE}
        selectedAreaIds={["a1"]}
        onToggle={vi.fn()}
        indirectAreas={[
          {
            areaId: "a2",
            code: "A102",
            nameEl: "Θάλαμος 2",
            areaType: "WARD",
            patientRiskGroup: "HIGHEST",
            buildingCode: "A",
            floorCode: "1",
            impact: "INDIRECT",
            viaSystem: "ELECTRICAL",
          },
        ]}
      />,
    );
    expect(screen.getByText("Θάλαμος 2")).toBeInTheDocument();
    // RULE: no checkbox for an indirect area.
    expect(screen.queryByRole("checkbox", { name: /Θάλαμος 2/ })).not.toBeInTheDocument();
  });

  // M4's asset form: one area per asset, so the picker renders radios, not checkboxes.
  it("renders radios, not checkboxes, in single mode", async () => {
    const onToggle = vi.fn();
    renderWithIntl(<AreaPicker areaTree={TREE} selectedAreaIds={[]} onToggle={onToggle} mode="single" />);
    expect(screen.getByRole("radio", { name: /Χειρουργείο 1/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Χειρουργείο 1/ }));
    expect(onToggle).toHaveBeenCalledWith("a1");
  });
});
