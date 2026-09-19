import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { canManageContractors } from "@/auth/roles";
import type { Contractor } from "@ecapital/shared";
import { Contractors } from "./Contractors";

const contractor: Contractor = {
  id: "contractor-1",
  name: "Κυριάκου Τεχνικές Κατασκευές Λτδ",
  vatNumber: "CY10231455X",
  registrationNo: "HE 118422",
  category: "BUILDING",
  sapVendorId: "V-100101",
  blacklisted: false,
};

// RULE (build brief, ADR-0015 "Who keeps the contractor register"): the page
// itself (`src/app/(app)/admin/contractors/page.tsx`) is gated by this exact
// predicate before it ever renders `ContractorsScreen` — an engineer never
// reaches the table at all. Testing the predicate the page calls is the
// faithful unit test for "NoPermission for an engineer", since the gate is
// a Server Component `if`, not a prop on `Contractors` itself.
describe("S24 page access (ADR-0015)", () => {
  it("refuses an engineer and admits admin/estates_head", () => {
    expect(canManageContractors(["project_engineer"])).toBe(false);
    expect(canManageContractors(["technician"])).toBe(false);
    expect(canManageContractors(["admin"])).toBe(true);
    expect(canManageContractors(["estates_head"])).toBe(true);
  });
});

describe("Contractors table — blacklist toggle visibility (ADR-0015, decided 19/09/2026)", () => {
  it("hides the Αποκλεισμός toggle for estates_head (isAdmin=false)", () => {
    renderWithIntl(
      <Contractors
        data={[contractor]}
        state="default"
        noPermission={<div />}
        isAdmin={false}
        selectedId={contractor.id}
        onSelect={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByText("Αποκλεισμός")).not.toBeInTheDocument();
  });

  it("shows the Αποκλεισμός toggle for admin", () => {
    renderWithIntl(
      <Contractors
        data={[contractor]}
        state="default"
        noPermission={<div />}
        isAdmin
        selectedId={contractor.id}
        onSelect={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText("Αποκλεισμός")).toBeInTheDocument();
  });
});
