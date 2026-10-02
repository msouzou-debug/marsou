import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { buildEFinanceSummary } from "@/mocks/efinance";
import { ContractOverview } from "./ContractOverview";
import { buildContractDetail } from "./fixture";

const noPermission = <div>no permission</div>;

// The API authors both sentences (apps/api/src/i18n/{el,en}.json); the strip
// only has to carry the right one for the caller's language.
const CONFLICT = {
  key: "efinanceConflict" as const,
  sentenceEl:
    "Το eFinance δεν δέχτηκε τη σύμβαση ΤΥ/2026/031 για το έργο «Αντικατάσταση ακτινολογικού εξοπλισμού» (Γ.Ν. Λάρνακας): ο αριθμός αναφοράς υπάρχει ήδη εκεί με άλλη μονάδα ή άλλο κωδικό προϋπολογισμού (entity NIC). Ελέγξτε τη μονάδα και τον κωδικό και στείλτε τη σύμβαση ξανά.",
  sentenceEn:
    "eFinance refused contract ΤΥ/2026/031 for project «Αντικατάσταση ακτινολογικού εξοπλισμού» (Larnaca General Hospital): the reference already exists there under another unit or budget code (entity NIC). Check the unit and the code, then send the contract again.",
  amount: null,
};
const NOT_PUSHABLE = {
  key: "efinanceNotPushable" as const,
  sentenceEl:
    "Η σύμβαση ΤΥ/2026/031 για το έργο «Αντικατάσταση ακτινολογικού εξοπλισμού» (Γ.Ν. Λάρνακας) δεν στάλθηκε στο eFinance, γιατί δεν έχει κωδικό προϋπολογισμού. Συμπληρώστε ό,τι λείπει για να σταλεί.",
  sentenceEn:
    "Contract ΤΥ/2026/031 for project «Αντικατάσταση ακτινολογικού εξοπλισμού» (Larnaca General Hospital) has not been sent to eFinance because it has no budget code. Fill in what is missing so it can be sent.",
  amount: null,
};

describe("ContractOverview — eFinance warnings (ADR-0029)", () => {
  it("renders both new warning keys in Greek", () => {
    const data = buildContractDetail({ warnings: [CONFLICT, NOT_PUSHABLE] });
    renderWithIntl(<ContractOverview data={data} state="default" noPermission={noPermission} />);
    expect(screen.getByText(/Το eFinance δεν δέχτηκε τη σύμβαση ΤΥ\/2026\/031/)).toBeInTheDocument();
    expect(screen.getByText(/δεν στάλθηκε στο eFinance, γιατί δεν έχει κωδικό προϋπολογισμού/)).toBeInTheDocument();
  });

  it("renders both new warning keys in English", () => {
    const data = buildContractDetail({ warnings: [CONFLICT, NOT_PUSHABLE] });
    renderWithIntl(<ContractOverview data={data} state="default" noPermission={noPermission} />, { locale: "en" });
    expect(screen.getByText(/eFinance refused contract ΤΥ\/2026\/031/)).toBeInTheDocument();
    expect(screen.getByText(/has not been sent to eFinance because it has no budget code/)).toBeInTheDocument();
  });

  it("never blocks the page: the strip is information, the facts are still there", () => {
    const data = buildContractDetail({ warnings: [CONFLICT] });
    renderWithIntl(<ContractOverview data={data} state="default" noPermission={noPermission} roles={["admin"]} />);
    expect(screen.getByText("Κωδικός προϋπολογισμού")).toBeInTheDocument();
  });
});

describe("ContractOverview — eFinance block (ADR-0029)", () => {
  it("shows the quiet not-configured line when efinance is null", () => {
    const data = buildContractDetail({ efinance: null });
    renderWithIntl(<ContractOverview data={data} state="default" noPermission={noPermission} roles={["admin"]} />);
    expect(screen.getByText("Δεν έχει ρυθμιστεί η σύνδεση με το eFinance")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Αποστολή στο eFinance" })).not.toBeInTheDocument();
  });

  it("shows the panel with its figures when eFinance answered", () => {
    const data = buildContractDetail({ efinance: buildEFinanceSummary() });
    renderWithIntl(<ContractOverview data={data} state="default" noPermission={noPermission} />);
    expect(screen.getByText("Σύνδεση με το eFinance")).toBeInTheDocument();
    expect(screen.getByTestId("efinance-requisitions")).toBeInTheDocument();
  });

  it("offers the push button to an admin only, wired to onPushEfinance", () => {
    const onPush = vi.fn();
    const data = buildContractDetail({ efinance: buildEFinanceSummary() });
    const { unmount } = renderWithIntl(
      <ContractOverview data={data} state="default" noPermission={noPermission} roles={["project_engineer"]} onPushEfinance={onPush} />,
    );
    expect(screen.queryByRole("button", { name: "Αποστολή στο eFinance" })).not.toBeInTheDocument();
    unmount();

    renderWithIntl(
      <ContractOverview data={data} state="default" noPermission={noPermission} roles={["admin"]} onPushEfinance={onPush} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Αποστολή στο eFinance" }));
    expect(onPush).toHaveBeenCalledTimes(1);
  });

  it("does not put eFinance's figures into the CostBar", () => {
    const data = buildContractDetail({ efinance: buildEFinanceSummary({ booked: 123_456 }) });
    renderWithIntl(<ContractOverview data={data} state="default" noPermission={noPermission} />);
    // The figure appears once, inside the eFinance panel, and nowhere in the
    // CostBar's legend (whose own «Δαπάνες» stays «—»: spent is null here).
    const matches = screen.getAllByText(formatEUR(123_456).replace(/\s/g, " "));
    expect(matches).toHaveLength(1);
    expect(matches[0].closest("section")).toHaveAttribute("aria-labelledby", "efinance-panel-title");
  });
});
