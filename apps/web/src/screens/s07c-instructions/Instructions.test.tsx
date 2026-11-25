import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { nicosiaDateOf } from "@ecapital/shared";
import { formatDate } from "@/lib/format";
import { renderWithIntl } from "@/test/render";
import { buildContractDetail } from "../s07-contract/fixture";
import { buildInstructions } from "./fixture";
import { Instructions } from "./Instructions";

const noPermission = <div>no permission</div>;
const instructions = buildInstructions();

const contractWithVariation = buildContractDetail({
  variations: [
    {
      id: "variation-linked-1",
      contractId: "contract-1",
      number: 4,
      descriptionEl: "x",
      reason: "CLIENT_CHANGE",
      value: 0,
      timeImpactDays: 0,
      status: "DRAFT",
      raisedById: "user-engineer",
      raisedByName: "Ελένη Χριστοδούλου",
      raisedAt: "2026-07-10T09:00:00.000Z",
      decidedById: null,
      decidedByName: null,
      decidedAt: null,
      decisionCommentEl: null,
    },
  ],
});

describe("Instructions — R09, ADR-0017", () => {
  it("shows no create-variation button for an instruction without cost impact", () => {
    renderWithIntl(
      <Instructions contract={contractWithVariation} instructions={instructions} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onCreateVariation={vi.fn()} />,
    );
    const noCostImpactRow = instructions.find((i) => !i.costImpactFlag)!;
    const row = screen.getByText(noCostImpactRow.textEl).closest("tr")!;
    expect(row.querySelector("button")).toBeNull();
  });

  it("shows the create-variation button for a cost-impact instruction with no variation yet", () => {
    renderWithIntl(
      <Instructions contract={contractWithVariation} instructions={instructions} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onCreateVariation={vi.fn()} />,
    );
    const unlinkedRow = instructions.find((i) => i.costImpactFlag && !i.variationId)!;
    const row = screen.getByText(unlinkedRow.textEl).closest("tr")!;
    expect(row.querySelector("button")).not.toBeNull();
    expect(row.textContent).toContain("Δημιουργία τροποποίησης");
  });

  it("shows the link to the variation for a linked instruction, not the create button", () => {
    renderWithIntl(
      <Instructions contract={contractWithVariation} instructions={instructions} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onCreateVariation={vi.fn()} />,
    );
    const linkedRow = instructions.find((i) => i.variationId)!;
    const row = screen.getByText(linkedRow.textEl).closest("tr")!;
    expect(row.querySelector("a")).not.toBeNull();
    expect(row.textContent).toContain("Τροποποίηση 4");
    expect(row.querySelector("button")).toBeNull();
  });

  it("shows the amber strip when the contract carries the instructionsWithoutVariation warning", () => {
    const withWarning = buildContractDetail({
      warnings: [
        { key: "instructionsWithoutVariation", sentenceEl: "Προσοχή στις οδηγίες.", sentenceEn: "Watch the instructions.", amount: null },
      ],
    });
    renderWithIntl(
      <Instructions contract={withWarning} instructions={instructions} state="default" noPermission={noPermission} roles={["project_engineer"]} onSelect={vi.fn()} onCreate={vi.fn()} onCreateVariation={vi.fn()} />,
    );
    expect(screen.getByText("Προσοχή στις οδηγίες.")).toBeInTheDocument();
  });

  it("hides «Προσθήκη» for a role that cannot write the log", () => {
    renderWithIntl(
      <Instructions contract={contractWithVariation} instructions={instructions} state="default" noPermission={noPermission} roles={["technician"]} onSelect={vi.fn()} onCreate={vi.fn()} onCreateVariation={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Προσθήκη" })).not.toBeInTheDocument();
  });
});

describe("Instructions — detail and edit (UAT 25/11/2026)", () => {
  const unlinked = instructions.find((i) => !i.variationId && i.costImpactFlag)!;
  const linked = instructions.find((i) => i.variationId)!;

  function renderSelected(selectedId: string | null, props: Partial<Parameters<typeof Instructions>[0]> = {}) {
    return renderWithIntl(
      <Instructions
        contract={contractWithVariation}
        instructions={instructions}
        state="default"
        noPermission={noPermission}
        roles={["project_engineer"]}
        selectedId={selectedId}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onCreateVariation={vi.fn()}
        onUpdate={vi.fn().mockResolvedValue(true)}
        {...props}
      />,
    );
  }

  it("opens an instruction when its row is clicked, but not from its create-variation button", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onCreateVariation = vi.fn();
    renderSelected(null, { onSelect, onCreateVariation });
    const row = screen.getByText(unlinked.textEl).closest("tr")!;
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith(unlinked.id);

    onSelect.mockClear();
    await user.click(within(row).getByRole("button", { name: "Δημιουργία τροποποίησης" }));
    expect(onCreateVariation).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows every field, and no «Επεξεργασία» once it has become a variation", () => {
    renderSelected(linked.id);
    const dialog = within(screen.getByRole("dialog", { name: `Οδηγία εργοταξίου ${linked.number}` }));
    expect(dialog.getByText(linked.textEl)).toBeInTheDocument();
    expect(dialog.getByText(linked.issuedByName)).toBeInTheDocument();
    expect(dialog.getByText(formatDate(linked.issuedAt))).toBeInTheDocument();
    expect(dialog.getByText("Τροποποίηση 4")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Επεξεργασία" })).not.toBeInTheDocument();
    expect(dialog.getByText("Η οδηγία έχει γίνει τροποποίηση σύμβασης και δεν αλλάζει πια.")).toBeInTheDocument();
  });

  it("offers no «Επεξεργασία» to a role that only reads the log", () => {
    renderSelected(unlinked.id, { roles: ["finance"] });
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Επεξεργασία" })).not.toBeInTheDocument();
  });

  it("edits the text and issue day, refusing a day after today", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(true);
    renderSelected(unlinked.id, { onUpdate });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Επεξεργασία" }));

    const dialog = within(screen.getByRole("dialog", { name: `Επεξεργασία οδηγίας εργοταξίου ${unlinked.number}` }));
    const issuedOn = dialog.getByLabelText("Ημερομηνία έκδοσης");
    expect(issuedOn).toHaveValue(nicosiaDateOf(unlinked.issuedAt));

    const tomorrow = new Date(`${nicosiaDateOf(new Date())}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    fireEvent.change(issuedOn, { target: { value: tomorrow.toISOString().slice(0, 10) } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(await dialog.findByText("Η ημερομηνία δεν μπορεί να είναι μεταγενέστερη της σημερινής.")).toBeInTheDocument();

    const text = dialog.getByLabelText("Οδηγία");
    await user.clear(text);
    await user.type(text, "Δύο σειρές ηχομονωτικών πάνελ.");
    fireEvent.change(issuedOn, { target: { value: "2026-07-01" } });
    await user.click(dialog.getByRole("button", { name: "Αποθήκευση" }));
    expect(onUpdate).toHaveBeenCalledWith({ textEl: "Δύο σειρές ηχομονωτικών πάνελ.", costImpactFlag: true, issuedOn: "2026-07-01" });
    expect(await screen.findByRole("dialog", { name: `Οδηγία εργοταξίου ${unlinked.number}` })).toBeInTheDocument();
  });
});
