import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { ApproverScopesEditor } from "./ApproverScopesEditor";
import { UserSheet } from "./UserSheet";
import { orgUnits, roleCatalogue, users } from "./fixture";

vi.mock("@/data/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/queries")>();
  return {
    ...actual,
    useApproverScopes: () => ({ data: { areas: [], units: [] }, refetch: vi.fn() }),
    useAreaTree: () => ({ data: { buildings: [] } }),
  };
});

/** The options of the unit-role picker, in order. */
function unitRoleOptions(): string[] {
  const select = screen
    .getAllByRole("combobox")
    .find((element) => within(element).queryByRole("option", { name: "Τεχνικές Υπηρεσίες" }));
  if (!select) return [];
  return within(select)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

/** ADR-0039 (owner decision 26/11/2026): the scopes the editor offers follow the roles. */
describe("S24 Χρήστες — approver scopes by role (ADR-0039)", () => {
  it("offers a technical and safety approver TECHNICAL and SAFETY only, and no area", () => {
    renderWithIntl(<ApproverScopesEditor userId="u1" orgUnits={orgUnits} roles={["technical_approver"]} />);
    expect(unitRoleOptions()).toEqual(["Τεχνικές Υπηρεσίες", "Ασφάλεια"]);
    expect(screen.queryByText("Ρόλοι ανά χώρο")).not.toBeInTheDocument();
  });

  it("offers a clinical approver every unit role and the area roles", () => {
    renderWithIntl(<ApproverScopesEditor userId="u1" orgUnits={orgUnits} roles={["clinical_approver"]} />);
    expect(unitRoleOptions()).toEqual([
      "Τεχνικές Υπηρεσίες",
      "Ασφάλεια",
      "Διευθυντής μονάδας",
      "Έλεγχος λοιμώξεων",
      "Νοσηλευτική υπηρεσία",
    ]);
    expect(screen.getByText("Ρόλοι ανά χώρο")).toBeInTheDocument();
  });

  it("shows the new role on the sheet, and the editor only for a role that may hold a scope", () => {
    const shared = { open: true, catalogue: roleCatalogue, orgUnits, onClose: vi.fn(), onSave: vi.fn() };
    const technician = { ...users[0], roles: ["technician" as const] };
    const { unmount } = renderWithIntl(<UserSheet {...shared} user={technician} />);
    expect(screen.getByLabelText("Εγκρίνων τεχνικών και ασφάλειας")).not.toBeChecked();
    expect(screen.queryByText("Χώροι και ρόλοι έγκρισης")).not.toBeInTheDocument();
    unmount();

    const technical = { ...users[0], roles: ["technical_approver" as const] };
    renderWithIntl(<UserSheet {...shared} user={technical} />);
    expect(screen.getByLabelText("Εγκρίνων τεχνικών και ασφάλειας")).toBeChecked();
    expect(screen.getByText("Χώροι και ρόλοι έγκρισης")).toBeInTheDocument();
    expect(unitRoleOptions()).toEqual(["Τεχνικές Υπηρεσίες", "Ασφάλεια"]);
  });
});
