import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { buildEFinanceInvoiceList } from "@/mocks/efinance";
import { buildContractDetail } from "@/screens/s07-contract/fixture";
import { EFinanceInvoices } from "./EFinanceInvoices";

const noPermission = <div>no permission</div>;
const eur = (value: number) => formatEUR(value).replace(/\s/g, " ");
const contract = buildContractDetail();

function renderList(extra: Partial<Parameters<typeof EFinanceInvoices>[0]> = {}) {
  return renderWithIntl(
    <EFinanceInvoices
      contract={contract}
      list={buildEFinanceInvoiceList()}
      state="default"
      noPermission={noPermission}
      onSelect={vi.fn()}
      {...extra}
    />,
  );
}

describe("EFinanceInvoices — table", () => {
  it("shows the tab strip with its own tab selected", () => {
    renderList();
    expect(screen.getByRole("tab", { name: "Τιμολόγια eFinance" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Αιτήματα eFinance" })).toBeInTheDocument();
  });

  it("renders the seven asked-for columns and the ledger chip", () => {
    renderList();
    const table = screen.getByRole("table");
    for (const header of ["Αρ. τιμολογίου", "Ημερομηνία", "Προμηθευτής", "Καθαρή αξία", "ΦΠΑ", "Μικτή αξία", "Κατάσταση", "Παρτίδα SAP"]) {
      expect(within(table).getByRole("columnheader", { name: new RegExp(header) })).toBeInTheDocument();
    }
    const row = within(table).getByText("ΤΠ-2026-0412").closest("tr") as HTMLElement;
    expect(within(row).getByText("14/08/2026")).toBeInTheDocument();
    expect(within(row).getByText("Κυριάκου Τεχνικές Κατασκευές Λτδ")).toBeInTheDocument();
    expect(within(row).getByText(eur(100_000))).toBeInTheDocument();
    expect(within(row).getByText(eur(19_000))).toBeInTheDocument();
    expect(within(row).getByText(eur(119_000))).toBeInTheDocument();
    expect(within(row).getByText("20/08/2026")).toBeInTheDocument();
    expect(within(row).getByText("Καταχωρισμένο")).toHaveAttribute("data-ledger", "booked");
  });

  it("shows all four ledgers as chips with their words", () => {
    renderList();
    const table = screen.getByRole("table");
    for (const word of ["Καταχωρισμένο", "Σε εξέλιξη", "Αντιλογισμένο", "Απορρίφθηκε"]) {
      expect(within(table).getByText(word)).toBeInTheDocument();
    }
  });

  // RULE: a reversed invoice carries its reason in the row.
  it("shows the reason of a reversed invoice in its row", () => {
    renderList();
    const row = within(screen.getByRole("table")).getByText("ΤΠ-2026-0390").closest("tr") as HTMLElement;
    expect(within(row).getByText("Διπλή καταχώριση του ίδιου τιμολογίου")).toBeInTheDocument();
  });

  it("renders unknown amounts as a dash, never 0", () => {
    renderList();
    const row = within(screen.getByRole("table")).getByText("ΤΠ-2026-0460").closest("tr") as HTMLElement;
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(within(row).queryByText(/^0/)).not.toBeInTheDocument();
  });

  it("says that only booked invoices count", () => {
    renderList();
    expect(screen.getByText(/Μόνο τα καταχωρισμένα τιμολόγια προσμετρώνται/)).toBeInTheDocument();
  });

  it("opens an invoice's lines through the «Γραμμές» button", () => {
    const onSelect = vi.fn();
    renderList({ onSelect });
    const row = within(screen.getByRole("table")).getByText("ΤΠ-2026-0412").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Γραμμές (2)" }));
    expect(onSelect).toHaveBeenCalledWith("inv-1");
  });
});

describe("EFinanceInvoices — lines sheet", () => {
  it("shows description, qty, unit price, total, cost centre, budget code and WBS for each line", () => {
    renderList({ selectedId: "inv-1" });
    const dialog = screen.getByRole("dialog", { name: "Τιμολόγιο ΤΠ-2026-0412" });
    expect(within(dialog).getByText("Προμήθεια και εγκατάσταση ακτινολογικού συστήματος")).toBeInTheDocument();
    for (const label of ["Ποσότητα", "Τιμή μονάδας", "Σύνολο", "Κέντρο κόστους", "Κωδικός προϋπολογισμού", "WBS"]) {
      expect(within(dialog).getAllByText(label)).toHaveLength(2);
    }
    expect(within(dialog).getByText("WBS-031-01")).toBeInTheDocument();
    expect(within(dialog).getAllByText("LAR-RAD")).toHaveLength(2);
    expect(within(dialog).getAllByText(eur(80_000)).length).toBeGreaterThanOrEqual(2);
    // A line without a WBS code shows a dash.
    expect(within(dialog).getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("shows a reversed invoice's reason and when, and says it does not count", () => {
    renderList({ selectedId: "inv-3" });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByTestId("invoice-reversal")).toHaveTextContent(/Αντιλογισμός στις 10\/08\/2026\s12:30: Διπλή καταχώριση του ίδιου τιμολογίου/);
    expect(within(dialog).getByText("Αντιλογίστηκε και δεν προσμετράται στις δαπάνες.")).toBeInTheDocument();
    expect(within(dialog).getByText("Το τιμολόγιο δεν έχει γραμμές.")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onSelect = vi.fn();
    renderList({ selectedId: "inv-1", onSelect });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe("EFinanceInvoices — phone cards", () => {
  it("renders a card per invoice next to the table, with number, vendor, amounts and chip", () => {
    renderList();
    // Both render in the DOM; CSS shows one (`tablet:hidden`/`hidden tablet:block`).
    const cards = screen.getAllByRole("listitem");
    expect(cards.length).toBeGreaterThanOrEqual(4);
    const card = cards.find((li) => li.textContent?.includes("ΤΠ-2026-0390")) as HTMLElement;
    expect(within(card).getByText("Αντιλογισμένο")).toBeInTheDocument();
    expect(within(card).getByText("Διπλή καταχώριση του ίδιου τιμολογίου")).toBeInTheDocument();
    expect(within(card).getByText(eur(29_750))).toBeInTheDocument();
  });
});

describe("EFinanceInvoices — states", () => {
  it("explains the empty state: rows appear once eFinance tags an invoice with this contract", () => {
    renderList({ list: { configured: true, items: [], total: 0 }, state: "empty" });
    expect(screen.getByText(/Θα εμφανιστούν όταν το eFinance συνδέσει ένα τιμολόγιο με αυτή τη σύμβαση/)).toBeInTheDocument();
  });

  it("says so in English", () => {
    renderWithIntl(
      <EFinanceInvoices
        contract={contract}
        list={{ configured: true, items: [], total: 0 }}
        state="empty"
        noPermission={noPermission}
        onSelect={vi.fn()}
      />,
      { locale: "en" },
    );
    expect(screen.getByText("No invoices yet. They appear once eFinance tags an invoice with this contract.")).toBeInTheDocument();
  });

  it("says the link is not configured when the API answers configured: false", () => {
    renderList({ list: { configured: false, items: [], total: 0 }, state: "empty" });
    expect(screen.getByText(/Δεν έχει ρυθμιστεί η σύνδεση με το eFinance/)).toBeInTheDocument();
  });

  it("shows the error state with a retry", () => {
    const onRetry = vi.fn();
    renderList({ list: undefined, state: "error", onRetry });
    fireEvent.click(screen.getByRole("button", { name: "Δοκιμάστε ξανά" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("renders the shell's NoPermission for the no-permission state", () => {
    renderList({ state: "noPermission" });
    expect(screen.getByText("no permission")).toBeInTheDocument();
  });

  it("shows the read-only banner offline", () => {
    renderList({ state: "offline" });
    expect(screen.getAllByText("Εκτός σύνδεσης. Βλέπετε αποθηκευμένα δεδομένα.").length).toBeGreaterThan(0);
  });
});
