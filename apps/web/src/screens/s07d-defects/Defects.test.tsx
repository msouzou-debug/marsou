import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nicosiaDateOf } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { formatDate } from "@/lib/format";
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
    const unfundedRow = defects.find((d) => !d.funded && d.status !== "CLOSED")!;
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

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Επεξεργασία" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByLabelText("Χρηματοδοτείται"));
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(/επιλέξτε το έργο που την καλύπτει/)).toBeInTheDocument();
  });
});

describe("Defects — detail and edit (UAT 25/11/2026)", () => {
  function tomorrow(): string {
    const date = new Date(`${nicosiaDateOf(new Date())}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  it("opens a defect when its row is clicked", async () => {
    const user = userEvent.setup();
    const defects = buildDefects();
    const onSelect = vi.fn();
    renderWithIntl(<Defects contract={contract} defects={defects} state="default" noPermission={noPermission} today={today} onSelect={onSelect} onCreate={vi.fn()} onUpdate={vi.fn()} />);
    await user.click(screen.getByText(defects[1].descriptionEl));
    expect(onSelect).toHaveBeenCalledWith(defects[1].id);
  });

  // Owner UAT 25/11/2026 (RFIs, same sheet): a visible way out, above the table.
  it("goes back to the list from «Πίσω στη λίστα», Escape or the backdrop, and covers the table", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const defects = buildDefects();
    renderWithIntl(
      <Defects contract={contract} defects={defects} state="default" noPermission={noPermission} roles={["project_engineer"]} today={today} selectedId={defects[0].id} onSelect={onSelect} onCreate={vi.fn()} onUpdate={vi.fn()} />,
    );
    expect(screen.getByRole("dialog").className).toMatch(/\bz-40\b/);
    await user.click(screen.getByRole("button", { name: "Πίσω στη λίστα" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await user.click(screen.getByTestId("side-sheet-backdrop"));
    expect(onSelect.mock.calls).toEqual([[null], [null], [null]]);
  });

  it("shows every field read-only, with «Επεξεργασία» for a writer", () => {
    const defects = buildDefects();
    const open = defects.find((d) => d.status === "IN_PROGRESS")!;
    renderWithIntl(
      <Defects contract={contract} defects={defects} state="default" noPermission={noPermission} roles={["project_engineer"]} today={today} selectedId={open.id} onSelect={vi.fn()} onCreate={vi.fn()} onUpdate={vi.fn()} />,
    );
    const dialog = within(screen.getByRole("dialog"));
    for (const label of ["Προέλευση", "Χώρος", "Κατηγορία κινδύνου", "Εκτιμώμενο κόστος", "Χρηματοδοτείται", "Κατάσταση", "Καταχώρισε", "Ημερομηνία εντοπισμού", "Προθεσμία"]) {
      expect(dialog.getByText(label)).toBeInTheDocument();
    }
    expect(dialog.getByText(formatDate(open.raisedAt))).toBeInTheDocument();
    expect(dialog.queryByRole("textbox")).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Επεξεργασία" })).toBeInTheDocument();
  });

  it("offers no «Επεξεργασία» to a reader, and only «Επανάνοιγμα» on a closed defect", async () => {
    const user = userEvent.setup();
    const defects = buildDefects();
    const closed = defects.find((d) => d.status === "CLOSED")!;
    const { unmount } = renderWithIntl(
      <Defects contract={contract} defects={defects} state="default" noPermission={noPermission} roles={["finance"]} today={today} selectedId={defects[0].id} onSelect={vi.fn()} onCreate={vi.fn()} onUpdate={vi.fn()} />,
    );
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Επεξεργασία" })).not.toBeInTheDocument();
    unmount();

    const onReopen = vi.fn();
    renderWithIntl(
      <Defects contract={contract} defects={defects} state="default" noPermission={noPermission} roles={["project_engineer"]} today={today} selectedId={closed.id} onSelect={vi.fn()} onCreate={vi.fn()} onUpdate={vi.fn()} onReopen={onReopen} />,
    );
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByRole("button", { name: "Επεξεργασία" })).not.toBeInTheDocument();
    expect(dialog.getByText(/Η έλλειψη είναι κλειστή/)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Επανάνοιγμα" }));
    expect(onReopen).toHaveBeenCalled();
  });

  it("refuses a found-on day after today under the field, and saves a past one", async () => {
    const user = userEvent.setup();
    const defects = buildDefects();
    const open = defects.find((d) => d.status === "OPEN" && d.funded)!;
    const onUpdate = vi.fn().mockResolvedValue(true);
    renderWithIntl(
      <Defects contract={contract} defects={defects} state="default" noPermission={noPermission} roles={["project_engineer"]} today={today} selectedId={open.id} onSelect={vi.fn()} onCreate={vi.fn()} onUpdate={onUpdate} />,
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Επεξεργασία" }));
    const dialog = within(screen.getByRole("dialog"));
    const found = dialog.getByLabelText("Ημερομηνία εντοπισμού");
    expect(found).toHaveValue(nicosiaDateOf(open.raisedAt));

    fireEvent.change(found, { target: { value: tomorrow() } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(await screen.findByText("Η ημερομηνία δεν μπορεί να είναι μεταγενέστερη της σημερινής.")).toBeInTheDocument();

    fireEvent.change(found, { target: { value: "2026-05-30" } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ raisedOn: "2026-05-30", descriptionEl: open.descriptionEl }));
    // Saved: back to the read view.
    expect(await screen.findByRole("button", { name: "Επεξεργασία" })).toBeInTheDocument();
  });
});
