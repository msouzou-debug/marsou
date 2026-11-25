import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatEUR } from "@/lib/format";
import { renderWithIntl } from "@/test/render";
import { nicosiaDateOf } from "@ecapital/shared";
import { buildContractDetail } from "../s07-contract/fixture";
import { Claims } from "./Claims";
import { claimFormSchema } from "./schema";

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

  // RULE (date sanity): «Ημερομηνία κοινοποίησης» is not after today and not
  // before the award; the message is under the field and nothing is sent.
  it("refuses a date notified tomorrow, under the field", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderWithIntl(<Claims data={buildContractDetail()} state="default" noPermission={noPermission} roles={["estates_head"]} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Προσθήκη" }));
    const dialog = screen.getByRole("dialog", { name: "Νέα αξίωση" });
    await userEvent.type(within(dialog).getByLabelText("Τίτλος"), "Αξίωση");
    await userEvent.type(within(dialog).getByLabelText("Ποσό"), "100");
    const tomorrow = new Date(Date.parse(`${nicosiaDateOf()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const date = within(dialog).getByLabelText("Ημερομηνία κοινοποίησης");
    expect(date).toHaveAttribute("max", nicosiaDateOf());
    fireEvent.change(date, { target: { value: tomorrow } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Αποθήκευση" }));
    expect(within(dialog).getByText("Η ημερομηνία δεν μπορεί να είναι μεταγενέστερη της σημερινής.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses a date before the contract's award", () => {
    const schema = claimFormSchema("2026-01-10", () => "2026-11-25");
    const values = {
      direction: "BY_CONTRACTOR" as const,
      titleEl: "Αξίωση",
      amount: 1,
      stage: "NOTIFIED" as const,
      legalAdvisorEl: "",
      contingentLiability: false,
      notesEl: "",
    };
    const early = schema.safeParse({ ...values, notifiedAt: "2025-12-31" });
    expect(early.error?.issues[0]).toMatchObject({ path: ["notifiedAt"], message: "forms.dateBeforeAward" });
    expect(schema.safeParse({ ...values, notifiedAt: "2026-11-25" }).success).toBe(true);
    expect(schema.safeParse({ ...values, notifiedAt: "" }).success).toBe(true);
  });

  it("links each filed paper from the table and from the claim sheet", async () => {
    renderWithIntl(<Claims data={buildContractDetail()} state="default" noPermission={noPermission} roles={["project_engineer"]} />);
    const table = screen.getByRole("table", { name: /αξιώσεις του αναδόχου/i });
    expect(within(table).getByRole("link", { name: "Επιστολή αξίωσης" })).toHaveAttribute(
      "href",
      "/api/proxy/documents/doc-claim-1/content",
    );

    await userEvent.click(screen.getAllByRole("button", { name: "Επεξεργασία" })[1]);
    const papers = screen.getByTestId("claim-documents");
    expect(within(papers).getByText("Αρ. πρωτοκόλλου ΤΥ/2026/00412")).toBeInTheDocument();
    expect(within(papers).getByRole("link", { name: /Άνοιγμα/ })).toHaveAttribute("href", "/api/proxy/documents/doc-claim-1/content");
  });

  it("hands the picked paper and its kind to the save, with the claim", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderWithIntl(<Claims data={buildContractDetail()} state="default" noPermission={noPermission} roles={["estates_head"]} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Προσθήκη" }));
    const dialog = screen.getByRole("dialog", { name: "Νέα αξίωση" });
    await userEvent.type(within(dialog).getByLabelText("Τίτλος"), "Αξίωση με επιστολή");
    await userEvent.type(within(dialog).getByLabelText("Ποσό"), "2500");
    await userEvent.selectOptions(within(dialog).getByLabelText("Είδος εγγράφου"), "CLAIM_LEGAL_LETTER");
    const file = new File(["%PDF-1.7"], "dikigoros.pdf", { type: "application/pdf" });
    await userEvent.upload(within(dialog).getByLabelText("Αρχείο"), file);
    await userEvent.click(within(dialog).getByRole("button", { name: "Αποθήκευση" }));
    expect(onSave).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ titleEl: "Αξίωση με επιστολή", amount: 2500 }),
      { file, kind: "CLAIM_LEGAL_LETTER", titleEl: "" },
    );
  });
});
