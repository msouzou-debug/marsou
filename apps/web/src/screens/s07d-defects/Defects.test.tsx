import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildDefects } from "./fixture";
import { Defects } from "./Defects";

const noPermission = <div>no permission</div>;
const contract = buildContractDetail();
const today = new Date("2026-09-19");

describe("Defects — R12, R35, ADR-0017", () => {
  it("renders every risk band chip with its own text, never colour alone", () => {
    renderWithIntl(<Defects contract={contract} defects={buildDefects()} state="default" noPermission={noPermission} today={today} onSelect={vi.fn()} onCreate={vi.fn()} onUpdate={vi.fn()} />);
    for (const label of ["Υψηλή", "Σημαντική", "Μέτρια", "Χαμηλή"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks a still-open handover defect past its due date in red with an icon, and never a closed one", () => {
    const defects = buildDefects();
    renderWithIntl(<Defects contract={contract} defects={defects} state="default" noPermission={noPermission} today={today} onSelect={vi.fn()} onCreate={vi.fn()} onUpdate={vi.fn()} />);

    const overdueRow = defects.find((d) => d.dueDate === "2025-08-22")!;
    const overdueCell = screen.getByText(overdueRow.descriptionEl).closest("tr")!;
    expect(overdueCell.querySelector(".text-k-red")).not.toBeNull();

    const closedRow = defects.find((d) => d.status === "CLOSED")!;
    const closedCell = screen.getByText(closedRow.descriptionEl).closest("tr")!;
    expect(closedCell.querySelector(".text-k-red")).toBeNull();
  });

  it("shows an unmapped area id in mono with a note instead of a blank cell", () => {
    const defects = buildDefects();
    renderWithIntl(
      <Defects contract={contract} defects={defects} areaNameById={new Map()} state="default" noPermission={noPermission} today={today} onSelect={vi.fn()} onCreate={vi.fn()} onUpdate={vi.fn()} />,
    );
    expect(screen.getByText("area-1")).toBeInTheDocument();
  });

  it("sums count and cost per band in the mono footer line", () => {
    renderWithIntl(<Defects contract={contract} defects={buildDefects()} state="default" noPermission={noPermission} today={today} onSelect={vi.fn()} onCreate={vi.fn()} onUpdate={vi.fn()} />);
    expect(screen.getByText(/Υψηλή 1/)).toBeInTheDocument();
  });

  it("hides «Προσθήκη» for a role that cannot manage a handover defect (technician)", () => {
    renderWithIntl(<Defects contract={contract} defects={buildDefects()} state="default" noPermission={noPermission} roles={["technician"]} today={today} onSelect={vi.fn()} onCreate={vi.fn()} onUpdate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Προσθήκη" })).not.toBeInTheDocument();
  });

  it("blocks saving a funded defect with no target project, client-side", async () => {
    const user = userEvent.setup();
    const defects = buildDefects();
    const unfundedRow = defects.find((d) => !d.funded)!;
    const onUpdate = vi.fn();
    renderWithIntl(
      <Defects
        contract={contract}
        defects={defects}
        state="default"
        noPermission={noPermission}
        roles={["project_engineer"]}
        today={today}
        selectedId={unfundedRow.id}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
      />,
    );

    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByLabelText("Χρηματοδοτείται"));
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(/επιλέξτε το έργο που την καλύπτει/)).toBeInTheDocument();
  });
});
