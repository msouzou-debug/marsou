import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ROLE_MATRIX } from "@ecapital/shared";
import { setRoleMatrix } from "@/auth/roles";
import { formatEUR } from "@/lib/format";
import { renderWithIntl } from "@/test/render";
import { buildContractDetail } from "../s07-contract/fixture";
import { Delay } from "./Delay";

const noPermission = <div>no permission</div>;
const n = (text: string) => text.replace(/\s+/g, " ");

// ADR-0035 §7: APPROVE on the contract record is granted to admin and head
// of estates in the default matrix.
function grantActivation() {
  setRoleMatrix({
    ...ROLE_MATRIX,
    contractRecords: { ...ROLE_MATRIX.contractRecords, admin: "APPROVE", estates_head: "APPROVE" },
  });
}

afterEach(() => setRoleMatrix(null));

describe("Delay (S07h)", () => {
  it("shows the clocks with a totals row and the finance sentence", () => {
    renderWithIntl(<Delay data={buildContractDetail()} state="default" noPermission={noPermission} roles={["finance"]} />);
    const table = screen.getByRole("table", { name: /προθεσμίες ολοκλήρωσης/i });
    for (const header of ["Τμήμα", "Συμβατική ολοκλήρωση", "Παρατάσεις (ημέρες)", "Προθεσμία", "Παραλαβή", "Ημέρες καθυστέρησης", "Ρήτρα/ημέρα", "Ρήτρα σε εξέλιξη", "Ενεργοποίηση"]) {
      expect(within(table).getByRole("columnheader", { name: new RegExp(header.replace(/[()]/g, "\\$&")) })).toBeInTheDocument();
    }
    expect(within(table).getByText("Β · Ιατρικός εξοπλισμός")).toBeInTheDocument();
    const totals = table.querySelectorAll("tbody")[1];
    expect(totals).toHaveTextContent("Σύνολο");
    expect(n(totals.textContent ?? "")).toContain(n(formatEUR(42_300)));
    expect(
      screen.getByText("Η ρήτρα εμφανίζεται για ενημέρωση. Την παρακράτηση την κάνει η Οικονομική Διεύθυνση στην πιστοποίηση πληρωμής."),
    ).toBeInTheDocument();
  });

  it("lists the extensions newest first with approver label and the culpability answer", () => {
    renderWithIntl(<Delay data={buildContractDetail()} state="default" noPermission={noPermission} roles={["finance"]} />);
    const table = screen.getByRole("table", { name: /εγκεκριμένες παρατάσεις/i });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("ΚΕΑΑ");
    expect(rows[0]).toHaveTextContent("Υπαιτιότητα αναδόχου: Ναι");
    expect(rows[1]).toHaveTextContent("ΤΕΑΑ");
    expect(rows[1]).toHaveTextContent("Υπαιτιότητα αναδόχου: Όχι");
  });

  it("gives a read-only role no add, edit, delete or activate control", () => {
    grantActivation();
    renderWithIntl(<Delay data={buildContractDetail()} state="default" noPermission={noPermission} roles={["auditor_readonly"]} />);
    expect(screen.queryByRole("button", { name: /Προσθήκη/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Διαγραφή/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ενεργοποίηση ρήτρας/ })).not.toBeInTheDocument();
  });

  it("lets a project engineer write but not activate", () => {
    grantActivation();
    renderWithIntl(<Delay data={buildContractDetail()} state="default" noPermission={noPermission} roles={["project_engineer"]} />);
    expect(screen.getByRole("button", { name: "Προσθήκη παράτασης" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ενεργοποίηση ρήτρας/ })).not.toBeInTheDocument();
  });

  it("offers «Ενεργοποίηση ρήτρας» to the head of estates on a clock that is not activated yet, and sends date and note", async () => {
    grantActivation();
    const onActivate = vi.fn().mockResolvedValue(true);
    renderWithIntl(<Delay data={buildContractDetail()} state="default" noPermission={noPermission} roles={["estates_head"]} onActivate={onActivate} />);
    // Section Β is already activated; only Α offers the button.
    const buttons = screen.getAllByRole("button", { name: /Ενεργοποίηση ρήτρας/ });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    const dialog = screen.getByRole("dialog", { name: "Ενεργοποίηση ρήτρας" });
    await userEvent.type(within(dialog).getByLabelText("Ημερομηνία ενεργοποίησης"), "2026-11-09");
    await userEvent.type(within(dialog).getByLabelText("Σημείωση"), "Μετά την παραλαβή του Τμήματος Α");
    await userEvent.click(within(dialog).getByRole("button", { name: "Αποθήκευση" }));
    expect(onActivate).toHaveBeenCalledWith("section-a", { activatedAt: "2026-11-09", noteEl: "Μετά την παραλαβή του Τμήματος Α" });
  });

  it("refuses an extension without the culpability answer, then saves one judged not culpable", async () => {
    const onSaveExtension = vi.fn().mockResolvedValue(true);
    renderWithIntl(<Delay data={buildContractDetail()} state="default" noPermission={noPermission} roles={["project_engineer"]} onSaveExtension={onSaveExtension} />);
    await userEvent.click(screen.getByRole("button", { name: "Προσθήκη παράτασης" }));
    const dialog = screen.getByRole("dialog", { name: "Νέα παράταση" });
    await userEvent.type(within(dialog).getByLabelText("Ημέρες παράτασης"), "7");
    await userEvent.type(within(dialog).getByLabelText("Ημερομηνία έγκρισης"), "2026-11-02");
    await userEvent.selectOptions(within(dialog).getByLabelText("Έγκριση από"), "TEAA");
    await userEvent.type(within(dialog).getByLabelText("Όνομα εγκρίνοντος"), "ΤΕΑΑ Λάρνακας");
    await userEvent.type(within(dialog).getByLabelText("Αιτιολογία"), "Κακοκαιρία");
    await userEvent.click(within(dialog).getByRole("button", { name: "Αποθήκευση" }));
    expect(onSaveExtension).not.toHaveBeenCalled();
    expect(await within(dialog).findByText("Συμπληρώστε αυτό το πεδίο.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Όχι" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Αποθήκευση" }));
    expect(onSaveExtension).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: "", days: 7, approver: "TEAA", contractorCulpable: "no", approvedAt: "2026-11-02" }),
    );
  });

  it("adds a section with its code, title and dates", async () => {
    const onSaveSection = vi.fn().mockResolvedValue(true);
    renderWithIntl(<Delay data={buildContractDetail({ sections: [] })} state="default" noPermission={noPermission} roles={["estates_head"]} onSaveSection={onSaveSection} />);
    await userEvent.click(screen.getByRole("button", { name: "Προσθήκη τμήματος" }));
    const dialog = screen.getByRole("dialog", { name: "Προσθήκη τμήματος" });
    await userEvent.type(within(dialog).getByLabelText("Κωδικός"), "Γ");
    await userEvent.type(within(dialog).getByLabelText("Τίτλος"), "Τμήμα Γ");
    await userEvent.type(within(dialog).getByLabelText("Συμβατική ολοκλήρωση"), "2026-12-01");
    await userEvent.click(within(dialog).getByRole("button", { name: "Αποθήκευση" }));
    expect(onSaveSection).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ code: "Γ", titleEl: "Τμήμα Γ", completionDate: "2026-12-01", handoverDate: "", liquidatedDamagesPerDay: null }),
    );
  });

  it("deletes an extension only after the confirmation", async () => {
    const onDeleteExtension = vi.fn().mockResolvedValue(true);
    renderWithIntl(<Delay data={buildContractDetail()} state="default" noPermission={noPermission} roles={["project_engineer"]} onDeleteExtension={onDeleteExtension} />);
    const extensions = screen.getByRole("table", { name: /εγκεκριμένες παρατάσεις/i });
    await userEvent.click(within(extensions).getAllByRole("button", { name: "Διαγραφή" })[0]);
    expect(onDeleteExtension).not.toHaveBeenCalled();
    const confirmDialog = document.querySelector("dialog") as HTMLElement;
    await userEvent.click(within(confirmDialog).getByRole("button", { name: "Διαγραφή" }));
    expect(onDeleteExtension).toHaveBeenCalledWith("extension-2");
  });

  it("renders the no-permission element", () => {
    renderWithIntl(<Delay state="noPermission" noPermission={noPermission} />);
    expect(screen.getByText("no permission")).toBeInTheDocument();
  });

  it("speaks English", () => {
    renderWithIntl(<Delay data={buildContractDetail()} state="default" noPermission={noPermission} roles={["finance"]} />, { locale: "en" });
    expect(screen.getByText("The penalty is shown for information. Finance withholds it on the payment certificate.")).toBeInTheDocument();
  });
});
