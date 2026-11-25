// S09 — ADR-0038. VAT goes on the certificate's net payable at the
// contract's rate; the gross is what finance pays.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { CertificateForm } from "./CertificateForm";

const noop = () => undefined;

describe("CertificateForm — VAT (ADR-0038)", () => {
  it("works out the net payable, its VAT at the contract's rate and the gross live", () => {
    renderWithIntl(
      <CertificateForm
        contractId="c-1"
        contractVatRate="REDUCED_5"
        retentionPct={5}
        previousCertified={100_000}
        onSave={noop}
        onCancel={noop}
      />,
    );
    expect((screen.getByLabelText("Συντελεστής ΦΠΑ") as HTMLSelectElement).value).toBe("REDUCED_5");
    fireEvent.change(screen.getByLabelText("Αξία εργασιών (σωρευτικά)"), { target: { value: "200000" } });
    // 200.000 − 5 % retention − 100.000 previously certified = 90.000 net.
    expect(screen.getByTestId("cert-net-payable")).toHaveTextContent("90.000 €");
    expect(screen.getByTestId("vat-amount")).toHaveTextContent("4.500 €");
    expect(screen.getByTestId("vat-gross")).toHaveTextContent("94.500 €");
  });

  it("shows «—» until the contract's retention and the earlier certificates are known", () => {
    renderWithIntl(<CertificateForm contractId="c-1" onSave={noop} onCancel={noop} />);
    expect(screen.getByTestId("cert-net-payable")).toHaveTextContent("—");
    expect(screen.getByTestId("vat-gross")).toHaveTextContent("—");
  });
});
