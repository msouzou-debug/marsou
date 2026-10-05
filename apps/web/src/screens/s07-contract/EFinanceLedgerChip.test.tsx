import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import type { EFinanceLedger } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { EFinanceLedgerChip, LEDGER_CHIP_CLASS } from "./EFinanceLedgerChip";

const CASES: Array<[EFinanceLedger, string, string, string]> = [
  ["booked", "Καταχωρισμένο", "Booked", "bg-k-green-bg"],
  ["in_flight", "Σε εξέλιξη", "In flight", "bg-k-amber-bg"],
  ["reversed", "Αντιλογισμένο", "Reversed", "bg-k-grey"],
  ["rejected", "Απορρίφθηκε", "Rejected", "bg-k-red-bg"],
];

describe("EFinanceLedgerChip — ledger → chip", () => {
  it.each(CASES)("%s reads «%s» in Greek, %s in English, and is %s", (ledger, el, en, background) => {
    const { unmount } = renderWithIntl(<EFinanceLedgerChip ledger={ledger} />);
    const chip = screen.getByText(el);
    expect(chip).toHaveClass(background);
    expect(chip).toHaveAttribute("data-ledger", ledger);
    unmount();
    renderWithIntl(<EFinanceLedgerChip ledger={ledger} />, { locale: "en" });
    expect(screen.getByText(en)).toBeInTheDocument();
  });

  it("maps all four ledgers and nothing else", () => {
    expect(Object.keys(LEDGER_CHIP_CLASS).sort()).toEqual(["booked", "in_flight", "rejected", "reversed"]);
  });

  it("never leans on colour alone: every chip carries a word", () => {
    for (const [ledger, el] of CASES) {
      const { unmount } = renderWithIntl(<EFinanceLedgerChip ledger={ledger} />);
      expect(screen.getByText(el).textContent).toBe(el);
      unmount();
    }
  });
});
