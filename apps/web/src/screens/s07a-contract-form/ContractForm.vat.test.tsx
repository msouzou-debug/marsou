// S07a — ADR-0038. The value is typed net, the «Συντελεστής ΦΠΑ» sits beside
// it, and «Ποσό ΦΠΑ» and «Σύνολο με ΦΠΑ» follow as the person types.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BudgetCode, Contractor } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { ContractForm } from "./ContractForm";

const contractors: Contractor[] = [
  {
    id: "contractor-1",
    name: "Δοκιμαστική Εργοληπτική Λτδ",
    vatNumber: "CY10000001X",
    registrationNo: "HE 100001",
    category: "BUILDING",
    sapVendorId: null,
    blacklisted: false,
  },
];

const budgetCodes: BudgetCode[] = [
  {
    code: "7402",
    descriptionEl: "Ιατρικός και λοιπός εξοπλισμός",
    descriptionEn: "Medical and other equipment",
    category: "equipment",
    isCapex: true,
    active: true,
    source: "SEED",
    syncedAt: null,
  },
];

describe("ContractForm — VAT (ADR-0038)", () => {
  it("takes the value net at 19 % by default, shows VAT and gross live, and sends the rate", async () => {
    const onSubmit = vi.fn();
    renderWithIntl(
      <ContractForm
        mode="create"
        contractors={contractors}
        budgetCodes={budgetCodes}
        submitting={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const rate = screen.getByLabelText("Συντελεστής ΦΠΑ") as HTMLSelectElement;
    expect(rate.value).toBe("STANDARD_19");

    fireEvent.change(screen.getByLabelText("Αρχική αξία (καθαρό ποσό)"), { target: { value: "200000" } });
    expect(screen.getByTestId("vat-amount")).toHaveTextContent("38.000 €");
    expect(screen.getByTestId("vat-gross")).toHaveTextContent("238.000 €");

    fireEvent.change(rate, { target: { value: "REDUCED_5" } });
    expect(screen.getByTestId("vat-gross")).toHaveTextContent("210.000 €");

    fireEvent.change(screen.getByLabelText("Αριθμός σύμβασης"), { target: { value: "ΤΥ/2026/900" } });
    fireEvent.change(screen.getByLabelText("Ημερομηνία ανάθεσης"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Κωδικός προϋπολογισμού"), { target: { value: "7402" } });
    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ originalValue: 200_000, vatRate: "REDUCED_5" });
  });

  it("in edit, shows the net on record with the rate to correct and its gross", () => {
    renderWithIntl(
      <ContractForm
        mode="edit"
        budgetCodes={budgetCodes}
        initialContractorName="Δοκιμαστική Εργοληπτική Λτδ"
        initialOriginalValue={100_000}
        initialValues={{
          contractNo: "ΤΥ/2026/900",
          vatRate: "EXEMPT",
          type: "LUMP_SUM",
          awardDate: "2026-09-01",
          startDate: null,
          completionDate: null,
          retentionPct: 5,
          performanceBondValue: null,
          bondExpiry: null,
          liquidatedDamagesPerDay: null,
          defectsLiabilityMonths: 12,
          sapPoNumber: null,
          emapRef: null,
          budgetCode: "7402",
        }}
        submitting={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("Συντελεστής ΦΠΑ") as HTMLSelectElement).value).toBe("EXEMPT");
    expect(screen.getByTestId("vat-amount")).toHaveTextContent("0,00 €");
    expect(screen.getByTestId("vat-gross")).toHaveTextContent("100.000 €");
  });
});
