// S07 — ADR-0025. The budget code fact: shown as "code — Greek description"
// when the contract has one, and the same "not recorded" text every other
// not-yet-filled fact on this list uses when it does not.
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { ContractFacts } from "./ContractFacts";
import { buildContractDetail } from "./fixture";

describe("ContractFacts — budget code (ADR-0025)", () => {
  it("shows the code with its Greek description", () => {
    const contract = buildContractDetail({
      budgetCode: "7402",
      budgetCodeDescriptionEl: "Ιατρικός και λοιπός εξοπλισμός",
      budgetCodeDescriptionEn: "Medical and other equipment",
    });
    renderWithIntl(<ContractFacts contract={contract} />);

    expect(screen.getByText("Κωδικός προϋπολογισμού")).toBeInTheDocument();
    expect(screen.getByText("7402 — Ιατρικός και λοιπός εξοπλισμός")).toBeInTheDocument();
  });

  it("shows the not-recorded text for a contract with no budget code yet", () => {
    const contract = buildContractDetail({
      budgetCode: null,
      budgetCodeDescriptionEl: null,
      budgetCodeDescriptionEn: null,
    });
    renderWithIntl(<ContractFacts contract={contract} />);

    expect(screen.getByText("Δεν έχει καταχωριστεί")).toBeInTheDocument();
  });

  it("falls back to the bare code if the description is somehow missing", () => {
    const contract = buildContractDetail({
      budgetCode: "7402",
      budgetCodeDescriptionEl: null,
      budgetCodeDescriptionEn: null,
    });
    renderWithIntl(<ContractFacts contract={contract} />);

    expect(screen.getByText("7402 — 7402")).toBeInTheDocument();
  });
});
