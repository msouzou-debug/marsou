import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nicosiaDateOf } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { formatDate } from "@/lib/format";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildRfis } from "./fixture";
import { Rfis } from "./Rfis";

const noPermission = <div>no permission</div>;
const contract = buildContractDetail();
const now = new Date("2026-09-19T09:00:00.000Z");

describe("Rfis — R09, ADR-0017", () => {
  it("shows the answered date in mono once an RFI is answered, replacing the SlaChip", () => {
    const rfis = buildRfis(now);
    renderWithIntl(
      <Rfis contract={contract} rfis={rfis} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />,
    );

    const closedRow = rfis.find((r) => r.status === "CLOSED")!;
    const closedRowElement = screen.getByText(closedRow.questionEl).closest("tr")!;
    // The answered date, not a chip — RfiSheet is not open so this is the
    // table's own Προθεσμία column.
    expect(closedRowElement.textContent).toContain(formatDate(closedRow.answeredAt!));

    const openRow = rfis.find((r) => r.status === "OPEN" && r.slaState === "GREEN")!;
    const openRowElement = screen.getByText(openRow.questionEl).closest("tr")!;
    // A live chip for the still-open one.
    expect(openRowElement.querySelector("[class*='rounded-k-chip']")).not.toBeNull();
  });

  it("counts open and breached RFIs in the mono summary line", () => {
    renderWithIntl(
      <Rfis contract={contract} rfis={buildRfis(now)} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />,
    );
    // 2 OPEN (one breached, one green), 1 CLOSED — 2 open, 1 breached.
    expect(screen.getByText("2 ανοιχτά · 1 εκπρόθεσμα")).toBeInTheDocument();
  });

  it("hides «Προσθήκη» for a role that may read but not write the log (technician)", () => {
    renderWithIntl(
      <Rfis contract={contract} rfis={buildRfis(now)} state="default" noPermission={noPermission} roles={["technician"]} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Προσθήκη" })).not.toBeInTheDocument();
  });

  it("renders noPermission verbatim", () => {
    renderWithIntl(<Rfis state="noPermission" noPermission={<div>ασχετο</div>} onSelect={vi.fn()} onCreate={vi.fn()} onAnswer={vi.fn()} onCloseRfi={vi.fn()} />);
    expect(screen.getByText("ασχετο")).toBeInTheDocument();
  });
});

describe("Rfis — detail and edit (UAT 25/11/2026)", () => {
  const rfis = buildRfis(now);
  const openRfi = rfis.find((r) => r.status === "OPEN" && r.slaState === "GREEN")!;
  const closedRfi = rfis.find((r) => r.status === "CLOSED")!;

  function renderSelected(selectedId: string | null, props: Partial<Parameters<typeof Rfis>[0]> = {}) {
    return renderWithIntl(
      <Rfis
        contract={contract}
        rfis={rfis}
        state="default"
        noPermission={noPermission}
        roles={["project_engineer"]}
        selectedId={selectedId}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onAnswer={vi.fn()}
        onCloseRfi={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(true)}
        {...props}
      />,
    );
  }

  it("opens an RFI when its row is clicked, and on Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderSelected(null, { onSelect });
    const row = screen.getByText(openRfi.questionEl).closest("tr")!;
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith(openRfi.id);

    onSelect.mockClear();
    act(() => row.focus());
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(openRfi.id);
  });

  it("shows number, question, who raised it and when, due date, status and the answer", () => {
    renderSelected(closedRfi.id);
    const dialog = within(screen.getByRole("dialog", { name: `Αίτημα διευκρίνισης ${closedRfi.number}` }));
    expect(dialog.getByText(closedRfi.questionEl)).toBeInTheDocument();
    expect(dialog.getByText(closedRfi.answerEl!)).toBeInTheDocument();
    expect(dialog.getByText("Υπέβαλε").nextElementSibling?.textContent).toContain(closedRfi.raisedByName);
    expect(dialog.getByText(formatDate(closedRfi.raisedAt))).toBeInTheDocument();
    expect(dialog.getByText(formatDate(closedRfi.slaDueAt))).toBeInTheDocument();
    expect(dialog.getByText("Έκλεισε")).toBeInTheDocument();
    // A closed RFI is not edited.
    expect(dialog.queryByRole("button", { name: "Επεξεργασία" })).not.toBeInTheDocument();
    expect(dialog.getByText("Το αίτημα διευκρίνισης είναι κλειστό και δεν αλλάζει πια.")).toBeInTheDocument();
  });

  it("offers no «Επεξεργασία» to a role that only reads the log", () => {
    renderSelected(openRfi.id, { roles: ["finance"] });
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Επεξεργασία" })).not.toBeInTheDocument();
  });

  it("edits the question and due date, refusing a due date before the day it was raised", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    renderSelected(openRfi.id, { onUpdate });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Επεξεργασία" }));

    const dialog = within(screen.getByRole("dialog", { name: `Επεξεργασία αιτήματος διευκρίνισης ${openRfi.number}` }));
    const due = dialog.getByLabelText("Προθεσμία");
    expect(due).toHaveValue(nicosiaDateOf(openRfi.slaDueAt));

    const dayBefore = new Date(`${nicosiaDateOf(openRfi.raisedAt)}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    fireEvent.change(due, { target: { value: dayBefore.toISOString().slice(0, 10) } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(await dialog.findByText("Η προθεσμία δεν μπορεί να είναι πριν από την ημερομηνία υποβολής.")).toBeInTheDocument();

    const question = dialog.getByLabelText("Ερώτηση");
    await user.clear(question);
    await user.type(question, "Ποιος τύπος πυράντοχης θύρας ισχύει;");
    fireEvent.change(due, { target: { value: "2026-09-30" } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).toHaveBeenCalledWith({ questionEl: "Ποιος τύπος πυράντοχης θύρας ισχύει;", dueDate: "2026-09-30" });
    // Saved: back to the read view.
    expect(await screen.findByRole("dialog", { name: `Αίτημα διευκρίνισης ${openRfi.number}` })).toBeInTheDocument();
  });
});
