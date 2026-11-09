import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { buildContractDetail } from "../s07-contract/fixture";
import { CertificateForm } from "./CertificateForm";

const noop = () => undefined;

describe("CertificateForm — delay penalty notice (ADR-0035)", () => {
  it("shows the amount and the days as an info notice, never as an input", () => {
    const delay = buildContractDetail().delay!;
    renderWithIntl(<CertificateForm contractId="c-1" contractNo="ΤΥ/2026/031" delay={delay} onSave={noop} onCancel={noop} />);
    const notice = screen.getByRole("note");
    expect(notice.textContent?.replace(/\s+/g, " ")).toBe(
      "Ρήτρα καθυστέρησης σε εξέλιξη: 42.300 € (29 ημέρες). Η παρακράτηση γίνεται από την Οικονομική Διεύθυνση.".replace(/\s+/g, " "),
    );
    // The four existing inputs are the only inputs: the penalty is not one.
    expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
  });

  it("shows nothing when no penalty is accruing", () => {
    const delay = { ...buildContractDetail().delay!, totalAmount: null, totalDaysLate: 0 };
    renderWithIntl(<CertificateForm contractId="c-1" delay={delay} onSave={noop} onCancel={noop} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    renderWithIntl(<CertificateForm contractId="c-1" delay={{ ...delay, totalAmount: 0 }} onSave={noop} onCancel={noop} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows nothing without delay figures", () => {
    renderWithIntl(<CertificateForm contractId="c-1" onSave={noop} onCancel={noop} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
