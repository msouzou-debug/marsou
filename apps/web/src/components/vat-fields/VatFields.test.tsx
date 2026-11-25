import { describe, expect, it } from "vitest";
import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import type { VatRate } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { GrossAmount, VatRateSelect, VatSummary, vatRateFraction } from "./VatFields";

function Live() {
  const [net, setNet] = useState("");
  const [rate, setRate] = useState<VatRate>("STANDARD_19");
  return (
    <>
      <label htmlFor="net">Καθαρό ποσό</label>
      <input id="net" value={net} onChange={(event) => setNet(event.target.value)} />
      <VatRateSelect id="rate" value={rate} onChange={(event) => setRate(event.target.value as VatRate)} />
      <VatSummary net={net === "" ? null : Number(net)} rate={rate} />
    </>
  );
}

describe("VatFields (ADR-0038)", () => {
  it("offers the five rates, with «Απαλλαγή» for an exempt supply", () => {
    renderWithIntl(<VatRateSelect id="r" defaultValue="STANDARD_19" />);
    const select = screen.getByLabelText("Συντελεστής ΦΠΑ");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["19%", "9%", "5%", "0%", "Απαλλαγή"]);
  });

  it("works out VAT and the gross live as the net and the rate change", () => {
    renderWithIntl(<Live />);
    expect(screen.getByTestId("vat-amount")).toHaveTextContent("—");
    fireEvent.change(screen.getByLabelText("Καθαρό ποσό"), { target: { value: "100000" } });
    expect(screen.getByTestId("vat-amount")).toHaveTextContent("19.000 €");
    expect(screen.getByTestId("vat-gross")).toHaveTextContent("119.000 €");
    fireEvent.change(screen.getByLabelText("Συντελεστής ΦΠΑ"), { target: { value: "REDUCED_5" } });
    expect(screen.getByTestId("vat-gross")).toHaveTextContent("105.000 €");
    fireEvent.change(screen.getByLabelText("Συντελεστής ΦΠΑ"), { target: { value: "EXEMPT" } });
    expect(screen.getByTestId("vat-amount")).toHaveTextContent("0,00 €");
    expect(screen.getByTestId("vat-gross")).toHaveTextContent("100.000 €");
  });

  it("rounds the half cent the way the database does", () => {
    renderWithIntl(<VatSummary net={10.5} rate="STANDARD_19" />);
    expect(screen.getByTestId("vat-amount")).toHaveTextContent("2,00 €");
    expect(screen.getByTestId("vat-gross")).toHaveTextContent("12,50 €");
  });

  it("shows the gross with the net and the VAT one hover away", () => {
    renderWithIntl(<GrossAmount gross={119_000} net={100_000} vat={19_000} />);
    const cell = screen.getByText("119.000 €");
    expect(cell.getAttribute("title")?.replace(/\s/g, " ")).toBe("Καθαρό ποσό 100.000 € · ΦΠΑ 19.000 €");
  });

  it("gives the export the rate as a fraction", () => {
    expect(vatRateFraction("STANDARD_19")).toBe(0.19);
    expect(vatRateFraction("EXEMPT")).toBe(0);
  });
});
