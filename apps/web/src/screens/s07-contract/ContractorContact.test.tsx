import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { buildContractDetail } from "./fixture";
import { ContractorContact } from "./ContractorContact";

/** Owner UAT 25/11/2026: the contract page's contractor block. */
describe("ContractorContact", () => {
  const base = buildContractDetail().contractor;

  it("shows the contact person, a mailto link and the telephone", () => {
    renderWithIntl(
      <ContractorContact
        contractor={{
          ...base,
          contactName: "Μαρία Ιωάννου",
          contactEmail: "maria@contractor.example",
          contactPhone: "22 123456",
          contactSource: "EFINANCE",
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Ανάδοχος" })).toBeInTheDocument();
    expect(screen.getByText(base.name)).toBeInTheDocument();
    expect(screen.getByText("Μαρία Ιωάννου")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "maria@contractor.example" })).toHaveAttribute(
      "href",
      "mailto:maria@contractor.example",
    );
    expect(screen.getByText("22 123456")).toBeInTheDocument();
    expect(screen.getByText("Από το eFinance.")).toBeInTheDocument();
  });

  it("says where to fill it in when there is no contact", () => {
    renderWithIntl(<ContractorContact contractor={base} />);
    expect(screen.getByText(/Δεν έχουν καταχωριστεί στοιχεία επικοινωνίας/)).toBeInTheDocument();
  });
});
