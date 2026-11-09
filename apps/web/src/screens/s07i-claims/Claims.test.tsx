import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatEUR } from "@/lib/format";
import { renderWithIntl } from "@/test/render";
import { buildContractDetail } from "../s07-contract/fixture";
import { Claims } from "./Claims";

const noPermission = <div>no permission</div>;
const n = (text: string) => text.replace(/\s+/g, " ");

describe("Claims (S07i)", () => {
  it("lists claims with direction, stage chip and the contingent-liability flag", () => {
    renderWithIntl(<Claims data={buildContractDetail()} state="default" noPermission={noPermission} roles={["finance"]} />);
    const table = screen.getByRole("table", { name: /αξιώσεις του αναδόχου/i });
    expect(within(table).getAllByText("Αξίωση αναδόχου").length).toBe(2);
    expect(within(table).getByText("Αξίωση Οργανισμού")).toBeInTheDocument();
    for (const stage of ["Υπό εξέταση", "Κοινοποιήθηκε", "Διευθετήθηκε"]) {
      expect(within(table).getByText(stage)).toBeInTheDocument();
    }
    expect(within(table).getByRole("columnheader", { name: /Ενδεχόμενη υποχρέωση/ })).toBeInTheDocument();
    expect(within(table).getByText("Δικηγορικό Γραφείο Δείγμα")).toBeInTheDocument();
  });

  it("totals only the open stages, by direction", () => {
    renderWithIntl(<Claims data={buildContractDetail()} state="default" noPermission={noPermission} roles={["finance"]} />);
    // The settled 12.000 € claim is not counted.
    expect(n(screen.getByTestId("open-by-contractor").textContent ?? "")).toBe(n(formatEUR(85_000)));
    expect(n(screen.getByTestId("open-by-organisation").textContent ?? "")).toBe(n(formatEUR(37_500)));
  });

  it("hides add and edit from a read-only role", () => {
    renderWithIntl(<Claims data={buildContractDetail()} state="default" noPermission={noPermission} roles={["executive_readonly"]} />);
    expect(screen.queryByRole("button", { name: "Προσθήκη" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Επεξεργασία" })).not.toBeInTheDocument();
  });

  it("saves a new claim with the values typed", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderWithIntl(<Claims data={buildContractDetail()} state="default" noPermission={noPermission} roles={["estates_head"]} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Προσθήκη" }));
    const dialog = screen.getByRole("dialog", { name: "Νέα αξίωση" });
    await userEvent.selectOptions(within(dialog).getByLabelText("Είδος αξίωσης"), "BY_ORGANISATION");
    await userEvent.type(within(dialog).getByLabelText("Τίτλος"), "Αντιαξίωση");
    await userEvent.type(within(dialog).getByLabelText("Ποσό"), "1500");
    await userEvent.click(within(dialog).getByLabelText("Ενδεχόμενη υποχρέωση"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Αποθήκευση" }));
    expect(onSave).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ direction: "BY_ORGANISATION", titleEl: "Αντιαξίωση", amount: 1500, stage: "NOTIFIED", contingentLiability: true }),
    );
  });

  it("opens an existing claim for editing and saves against its id", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderWithIntl(<Claims data={buildContractDetail()} state="default" noPermission={noPermission} roles={["project_engineer"]} onSave={onSave} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Επεξεργασία" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Επεξεργασία αξίωσης" });
    await userEvent.selectOptions(within(dialog).getByLabelText("Στάδιο"), "NEGOTIATION");
    await userEvent.click(within(dialog).getByRole("button", { name: "Αποθήκευση" }));
    expect(onSave).toHaveBeenCalledWith(expect.stringMatching(/^claim-/), expect.objectContaining({ stage: "NEGOTIATION" }));
  });

  it("says so when there are no claims", () => {
    renderWithIntl(<Claims data={buildContractDetail({ claims: [] })} state="default" noPermission={noPermission} roles={["finance"]} />);
    expect(screen.getByText("Δεν έχουν καταγραφεί αξιώσεις για αυτή τη σύμβαση.")).toBeInTheDocument();
  });
});
