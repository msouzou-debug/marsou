import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { ContractTabs } from "./ContractTabs";

describe("ContractTabs — the eFinance tabs (ADR-0029)", () => {
  it("has «Τιμολόγια eFinance» and «Αιτήματα eFinance» as role=tab, last, with their own routes", () => {
    renderWithIntl(<ContractTabs contractId="c-1" active="overview" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Επισκόπηση",
      "Τροποποιήσεις",
      "Πιστοποιήσεις",
      "Αιτήματα διευκρίνισης",
      "Οδηγίες εργοταξίου",
      "Ελλείψεις",
      "Τιμολόγια eFinance",
      "Αιτήματα eFinance",
    ]);
    expect(screen.getByRole("tab", { name: "Τιμολόγια eFinance" })).toHaveAttribute("href", "/contracts/c-1/efinance/invoices");
    expect(screen.getByRole("tab", { name: "Αιτήματα eFinance" })).toHaveAttribute("href", "/contracts/c-1/efinance/requisitions");
  });

  it("marks the active eFinance tab selected", () => {
    renderWithIntl(<ContractTabs contractId="c-1" active="efinanceInvoices" />);
    expect(screen.getByRole("tab", { name: "Τιμολόγια eFinance" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Επισκόπηση" })).toHaveAttribute("aria-selected", "false");
  });

  it("names them in English too", () => {
    renderWithIntl(<ContractTabs contractId="c-1" active="overview" />, { locale: "en" });
    expect(screen.getByRole("tab", { name: "eFinance invoices" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "eFinance requisitions" })).toBeInTheDocument();
  });
});
