// S07a — ADR-0025. The «Κωδικός προϋπολογισμού» select: required to start a
// new contract, editable (including back to empty) afterwards.
import type { ComponentProps } from "react";
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
  {
    code: "7551",
    descriptionEl: "Επιβατικά οχήματα",
    descriptionEn: "Passenger vehicles",
    category: "vehicles",
    isCapex: true,
    active: true,
    source: "SEED",
    syncedAt: null,
  },
];

function renderForm(overrides: Partial<ComponentProps<typeof ContractForm>> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  renderWithIntl(
    <ContractForm
      mode="create"
      contractors={contractors}
      budgetCodes={budgetCodes}
      submitting={false}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onSubmit, onCancel };
}

/** Everything else a valid "create" submission needs, so the assertions are only about budgetCode. */
function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Αριθμός σύμβασης"), { target: { value: "ΤΥ/2026/900" } });
  fireEvent.change(screen.getByLabelText("Ημερομηνία ανάθεσης"), { target: { value: "2026-09-01" } });
}

describe("ContractForm — budget code (ADR-0025)", () => {
  it("lists the active codes with their Greek description, placeholder first", () => {
    renderForm();
    const select = screen.getByLabelText("Κωδικός προϋπολογισμού") as HTMLSelectElement;
    const options = Array.from(select.options).map((option) => option.textContent);
    expect(options[0]).toBe("Επιλέξτε κωδικό προϋπολογισμού");
    expect(options).toContain("7402 — Ιατρικός και λοιπός εξοπλισμός");
    expect(options).toContain("7551 — Επιβατικά οχήματα");
  });

  it("requires a budget code to create a contract", async () => {
    const { onSubmit } = renderForm();
    fillRequiredFields();

    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Συμπληρώστε αυτό το πεδίο.")).toBeInTheDocument();
  });

  it("submits the picked code", async () => {
    const { onSubmit } = renderForm();
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Κωδικός προϋπολογισμού"), { target: { value: "7551" } });

    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ budgetCode: "7551" });
  });

  it("does not require a budget code when editing an existing contract", async () => {
    const { onSubmit } = renderForm({
      mode: "edit",
      initialValues: {
        contractNo: "ΤΥ/2026/900",
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
        // Editing a contract recorded before this field existed: the select
        // opens on the placeholder rather than a stray option.
        budgetCode: "",
      },
      initialContractorName: contractors[0].name,
      initialOriginalValue: 500_000,
    });

    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ budgetCode: "" });
  });
});
