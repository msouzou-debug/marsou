// S08 — ADR-0038. A variation is raised net, at the contract's rate unless
// the raiser picks another; the decider sees the gross it commits.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { VariationSheet } from "./VariationSheet";
import { buildVariation } from "./fixture";

describe("VariationSheet — VAT (ADR-0038)", () => {
  it("raises a new variation at the contract's rate, overridable, with VAT and gross live", async () => {
    const onSave = vi.fn();
    renderWithIntl(
      <VariationSheet
        open
        contractNo="ΤΥ/2026/031"
        contractCurrentValue={2_400_000}
        contractCurrentGross={2_856_000}
        contractVatRate="REDUCED_9"
        meUserId="user-engineer"
        canDecide={false}
        canEdit
        onClose={vi.fn()}
        onSave={onSave}
        onSubmit={vi.fn()}
        onDecide={vi.fn()}
      />,
    );
    const rate = screen.getByLabelText("Συντελεστής ΦΠΑ") as HTMLSelectElement;
    expect(rate.value).toBe("REDUCED_9");
    // An omission: negative net, negative VAT.
    fireEvent.change(screen.getByLabelText("Αξία (καθαρό ποσό)"), { target: { value: "-1000" } });
    expect(screen.getByTestId("vat-amount")).toHaveTextContent("-90,00 €");
    expect(screen.getByTestId("vat-gross")).toHaveTextContent("-1.090 €");
    fireEvent.change(rate, { target: { value: "STANDARD_19" } });
    expect(screen.getByTestId("vat-gross")).toHaveTextContent("-1.190 €");

    fireEvent.change(screen.getByLabelText("Περιγραφή"), { target: { value: "Παράλειψη εργασιών" } });
    fireEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toMatchObject({ value: -1000, vatRate: "STANDARD_19" });
  });

  it("puts the gross before the decider, with the net beside it", () => {
    renderWithIntl(
      <VariationSheet
        open
        variation={buildVariation()}
        contractNo="ΤΥ/2026/031"
        contractCurrentValue={2_400_000}
        contractCurrentGross={2_856_000}
        contractVatRate="STANDARD_19"
        meUserId="someone-else"
        canDecide
        canEdit
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSubmit={vi.fn()}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.getByText("57.120 € (καθαρό 48.000 €)")).toBeInTheDocument();
    expect(screen.getByText("2.913.120 € (καθαρό 2.448.000 €)")).toBeInTheDocument();
  });
});
