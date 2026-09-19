import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { CostBar } from "./CostBar";

// formatEUR puts a thin space after the euro sign; Testing Library normalises
// the DOM text to plain spaces, so normalise the expected string the same way.
const eur = (value: number) => formatEUR(value).replace(/\s/g, " ");

const withinBudget = { approved: 2_400_000, committed: 2_150_000, spent: 1_274_000, forecast: 2_320_000 };

describe("CostBar", () => {
  it("shows the overflow segment and writes the amount when commitments exceed the approved budget", () => {
    renderWithIntl(<CostBar approved={2_400_000} committed={2_610_000} spent={1_880_000} forecast={2_685_000} />);

    expect(screen.getByTestId("cost-bar-overflow")).toBeInTheDocument();
    expect(screen.getByText("Υπέρβαση", { exact: false })).toBeInTheDocument();
    // RULE: the overflow is never colour alone — the amount is written out.
    expect(screen.getByText(eur(210_000))).toBeInTheDocument();
  });

  it("shows the overflow when spend exceeds the approved budget even if commitments do not", () => {
    renderWithIntl(<CostBar approved={1_000_000} committed={900_000} spent={1_150_000} forecast={1_200_000} />);

    expect(screen.getByTestId("cost-bar-overflow")).toBeInTheDocument();
    expect(screen.getByText(eur(150_000))).toBeInTheDocument();
  });

  it("shows no overflow segment while both ledgers stay under the approved budget", () => {
    renderWithIntl(<CostBar {...withinBudget} />);

    expect(screen.queryByTestId("cost-bar-overflow")).not.toBeInTheDocument();
    expect(screen.queryByText("Υπέρβαση", { exact: false })).not.toBeInTheDocument();
  });

  it("shows no overflow when spend exactly equals the approved budget", () => {
    renderWithIntl(<CostBar approved={800_000} committed={800_000} spent={800_000} forecast={800_000} />);

    expect(screen.queryByTestId("cost-bar-overflow")).not.toBeInTheDocument();
  });

  it("labels the four ledgers from the glossary with their figures in euro", () => {
    renderWithIntl(<CostBar {...withinBudget} />);

    for (const label of [
      "Εγκεκριμένος προϋπολογισμός",
      "Δεσμεύσεις",
      "Δαπάνες",
      "Πρόβλεψη τελικού κόστους",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(eur(2_400_000))).toBeInTheDocument();
    expect(screen.getByText(eur(1_274_000))).toBeInTheDocument();
  });

  // Nit 1: a caller such as S07 whose "approved"/"committed" ledgers carry
  // different words (Αρχική αξία / Τρέχουσα αξία) overrides just those two.
  it("overrides only the given legend labels, keeping the shared defaults for the rest", () => {
    renderWithIntl(
      <CostBar {...withinBudget} labels={{ approved: "Αρχική αξία", committed: "Τρέχουσα αξία" }} />,
    );

    expect(screen.getByText("Αρχική αξία")).toBeInTheDocument();
    expect(screen.getByText("Τρέχουσα αξία")).toBeInTheDocument();
    expect(screen.queryByText("Εγκεκριμένος προϋπολογισμός")).not.toBeInTheDocument();
    expect(screen.queryByText("Δεσμεύσεις")).not.toBeInTheDocument();
    // The other two ledgers keep the glossary's own words.
    expect(screen.getByText("Δαπάνες")).toBeInTheDocument();
    expect(screen.getByText("Πρόβλεψη τελικού κόστους")).toBeInTheDocument();
  });

  it("renders a skeleton bar while loading and one sentence when there is no budget", () => {
    const { unmount } = renderWithIntl(<CostBar {...withinBudget} state="loading" />);
    expect(screen.getByLabelText("Φόρτωση στοιχείων κόστους")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    unmount();

    renderWithIntl(<CostBar approved={0} committed={0} spent={0} forecast={0} />);
    expect(
      screen.getByText("Δεν έχει καταχωριστεί προϋπολογισμός για αυτό το έργο."),
    ).toBeInTheDocument();
  });

  it("explains the failure and offers a retry in the error state", () => {
    renderWithIntl(<CostBar {...withinBudget} state="error" onRetry={() => undefined} />);
    expect(
      screen.getByText("Τα στοιχεία κόστους δεν φορτώθηκαν. Δοκιμάστε ξανά."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Δοκιμάστε ξανά" })).toBeInTheDocument();
  });

  // RULE (contract `ProjectLedgers`, S03): before the SAP import, committed,
  // spent and forecast are null, never zero.
  it("shows only the approved track and a note, never zeroes, while committed/spent/forecast are null", () => {
    renderWithIntl(<CostBar approved={2_400_000} committed={null} spent={null} forecast={null} />);

    expect(
      screen.getByText("Δεσμεύσεις και δαπάνες θα εμφανιστούν μετά την εισαγωγή SAP."),
    ).toBeInTheDocument();
    expect(screen.getByText(eur(2_400_000))).toBeInTheDocument();
    // "—", not "€ 0" — never zero (UI instructions §6 nullable ledgers).
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByTestId("cost-bar-overflow")).not.toBeInTheDocument();
  });
});
