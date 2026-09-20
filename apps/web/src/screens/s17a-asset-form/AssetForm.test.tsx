import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
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
});
