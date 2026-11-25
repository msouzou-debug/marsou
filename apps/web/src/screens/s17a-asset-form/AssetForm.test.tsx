import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { OrgUnit } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { AssetForm } from "./AssetForm";

const ORG_UNITS: OrgUnit[] = [
  {
    id: "unit-1",
    code: "NGH",
    nameEl: "Νοσοκομείο Λευκωσίας",
    nameEn: "Nicosia General",
    type: "HOSPITAL",
    directorate: "LEFKOSIAS",
    costCentre: null,
    entityCode: "NGH",
    efinanceCode: "NGH",
    timezone: "Europe/Nicosia",
  },
];

function withQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("AssetForm", () => {
  // RULE (build brief item 2): a technician sees the form read-only — no submit control at all.
  it("shows no submit button in read-only mode", () => {
    renderWithIntl(
      withQuery(
        <AssetForm
          mode="edit"
          orgUnits={ORG_UNITS}
          editOrgUnitId="unit-1"
          readOnly={true}
          submitting={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
      ),
    );
    expect(screen.queryByRole("button", { name: "Αποθήκευση" })).not.toBeInTheDocument();
    expect(screen.getByText("Βλέπετε τα στοιχεία του παγίου χωρίς δικαίωμα επεξεργασίας. Η φυσική κατάσταση καταγράφεται από τη σελίδα του παγίου.")).toBeInTheDocument();
  });

  it("shows the save/cancel buttons for a writer", () => {
    renderWithIntl(
      withQuery(
        <AssetForm mode="create" orgUnits={ORG_UNITS} readOnly={false} submitting={false} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      ),
    );
    expect(screen.getByRole("button", { name: "Αποθήκευση" })).toBeInTheDocument();
  });

  // RULE (build brief item 2): serves-areas only when a system is set.
  it("hides the serves-areas picker until a system is chosen", () => {
    renderWithIntl(
      withQuery(
        <AssetForm mode="create" orgUnits={ORG_UNITS} readOnly={false} submitting={false} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      ),
    );
    expect(screen.queryByText("Εξυπηρετεί τους χώρους")).not.toBeInTheDocument();
  });

  it("shows the criticality helper text explaining 1 and 5", () => {
    renderWithIntl(
      withQuery(
        <AssetForm mode="create" orgUnits={ORG_UNITS} readOnly={false} submitting={false} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      ),
    );
    expect(screen.getByText("1 σημαίνει ζωτικής σημασίας για τη λειτουργία, 5 σημαίνει διακοσμητικό ή χωρίς κλινική επίπτωση.")).toBeInTheDocument();
  });

  // UAT 25/11/2026: say whose projects and contracts the two selects list.
  it("says under each source select that it lists the asset's own unit", () => {
    renderWithIntl(
      withQuery(
        <AssetForm mode="create" orgUnits={ORG_UNITS} readOnly={false} submitting={false} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      ),
    );
    expect(screen.getByText("Έργα της μονάδας του παγίου")).toBeInTheDocument();
    expect(screen.getByText("Συμβάσεις της μονάδας του παγίου")).toBeInTheDocument();
  });

  // UAT 25/11/2026, reported twice: a commissioning before the installation was saved.
  it("refuses dates out of order and a one-letter name, with the message under each field", async () => {
    const onSubmit = vi.fn();
    renderWithIntl(
      withQuery(
        <AssetForm
          mode="edit"
          orgUnits={ORG_UNITS}
          editOrgUnitId="unit-1"
          initialValues={{
            nameEl: "Α",
            assetClass: "HVAC",
            areaId: null,
            parentAssetId: null,
            manufacturer: null,
            model: null,
            serialNo: null,
            installedDate: "2024-03-10",
            commissionedDate: "2024-03-01",
            sourceProjectId: null,
            sourceContractId: null,
            capitalCost: null,
            warrantyEnd: null,
            expectedLifeYears: null,
            replacementYear: null,
            replacementCostEst: null,
            criticality: 3,
            system: null,
            servesAreaIds: [],
          }}
          readOnly={false}
          submitting={false}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    expect(await screen.findByText("Το όνομα έχει από 2 έως 200 χαρακτήρες.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Όνομα"), "ντλία");
    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    expect(
      await screen.findByText("Η θέση σε λειτουργία δεν μπορεί να είναι πριν από την ημερομηνία εγκατάστασης."),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
