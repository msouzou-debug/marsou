import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { buildEFinanceRequisitionList } from "@/mocks/efinance";
import { buildContractDetail } from "@/screens/s07-contract/fixture";
import { EFinanceRequisitions } from "./EFinanceRequisitions";

const noPermission = <div>no permission</div>;
const eur = (value: number) => formatEUR(value).replace(/\s/g, " ");
const contract = buildContractDetail();

describe("EFinanceRequisitions", () => {
  it("has its tab selected and shows number, description, amount, status, PO number and created date", () => {
    renderWithIntl(<EFinanceRequisitions contract={contract} list={buildEFinanceRequisitionList()} state="default" noPermission={noPermission} />);
    expect(screen.getByRole("tab", { name: "Αιτήματα eFinance" })).toHaveAttribute("aria-selected", "true");
    const table = screen.getByRole("table");
    for (const header of ["Αριθμός", "Περιγραφή", "Ποσό", "Κατάσταση", "Αρ. παραγγελίας", "Δημιουργήθηκε"]) {
      expect(within(table).getByRole("columnheader", { name: new RegExp(header) })).toBeInTheDocument();
    }
    const row = within(table).getByText("ΑΠ-2026-0088").closest("tr") as HTMLElement;
    expect(within(row).getByText("Ανταλλακτικά και αναλώσιμα ακτινολογικού συστήματος")).toBeInTheDocument();
    expect(within(row).getByText(eur(60_000))).toBeInTheDocument();
    expect(within(row).getByText("approved")).toBeInTheDocument();
    expect(within(row).getByText("4500012345")).toBeInTheDocument();
    expect(within(row).getByText("02/09/2026")).toBeInTheDocument();
  });

  it("renders a missing amount, description and PO number as dashes, never 0", () => {
    renderWithIntl(<EFinanceRequisitions contract={contract} list={buildEFinanceRequisitionList()} state="default" noPermission={noPermission} />);
    const row = within(screen.getByRole("table")).getByText("ΑΠ-2026-0097").closest("tr") as HTMLElement;
    expect(within(row).getAllByText("—")).toHaveLength(3);
  });

  it("says requisitions are eFinance's own commitments, not added to eCapital's", () => {
    renderWithIntl(<EFinanceRequisitions contract={contract} list={buildEFinanceRequisitionList()} state="default" noPermission={noPermission} />);
    expect(screen.getByText(/Δεν προστίθενται στις Δεσμεύσεις του eCapital/)).toBeInTheDocument();
  });

  it("renders a card per requisition for the phone layout", () => {
    renderWithIntl(<EFinanceRequisitions contract={contract} list={buildEFinanceRequisitionList()} state="default" noPermission={noPermission} />);
    const card = screen.getAllByRole("listitem").find((li) => li.textContent?.includes("ΑΠ-2026-0088")) as HTMLElement;
    expect(within(card).getByText(eur(60_000))).toBeInTheDocument();
    expect(within(card).getByText("4500012345")).toBeInTheDocument();
  });

  it("explains the empty state in both languages", () => {
    const empty = { configured: true, items: [], total: 0 };
    const { unmount } = renderWithIntl(<EFinanceRequisitions contract={contract} list={empty} state="empty" noPermission={noPermission} />);
    expect(screen.getByText(/Θα εμφανιστούν όταν το eFinance συνδέσει ένα αίτημα με αυτή τη σύμβαση/)).toBeInTheDocument();
    unmount();
    renderWithIntl(<EFinanceRequisitions contract={contract} list={empty} state="empty" noPermission={noPermission} />, { locale: "en" });
    expect(screen.getByText("No requisitions yet. They appear once eFinance tags a requisition with this contract.")).toBeInTheDocument();
  });

  it("says the link is not configured when the API answers configured: false", () => {
    renderWithIntl(
      <EFinanceRequisitions contract={contract} list={{ configured: false, items: [], total: 0 }} state="empty" noPermission={noPermission} />,
    );
    expect(screen.getByText(/Δεν έχει ρυθμιστεί η σύνδεση με το eFinance/)).toBeInTheDocument();
  });

  it("covers error and no-permission", () => {
    const { unmount } = renderWithIntl(<EFinanceRequisitions contract={contract} state="error" noPermission={noPermission} onRetry={vi.fn()} />);
    expect(screen.getByText("Τα δεδομένα δεν φορτώθηκαν. Δοκιμάστε ξανά.")).toBeInTheDocument();
    unmount();
    renderWithIntl(<EFinanceRequisitions state="noPermission" noPermission={noPermission} />);
    expect(screen.getByText("no permission")).toBeInTheDocument();
  });
});
