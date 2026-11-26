import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { ApproverScopesEditor } from "./ApproverScopesEditor";
import { UserSheet } from "./UserSheet";
import { orgUnits, roleCatalogue, users } from "./fixture";

// What the account has saved, per test; the editor reads it through the query.
const saved = vi.hoisted(() => ({ scopes: { areas: [], units: [] } as { areas: unknown[]; units: unknown[] } }));

vi.mock("@/data/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/queries")>();
  return {
    ...actual,
    useApproverScopes: () => ({ data: saved.scopes, refetch: vi.fn() }),
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

const editor = { userId: "u1", orgUnits, value: null, onChange: vi.fn() };

/** ADR-0039 (owner decision 26/11/2026): the scopes the editor offers follow the roles. */
describe("S24 Χρήστες — approver scopes by role (ADR-0039)", () => {
  it("offers a technical and safety approver TECHNICAL and SAFETY only, and no area", () => {
    renderWithIntl(<ApproverScopesEditor {...editor} roles={["technical_approver"]} />);
    expect(unitRoleOptions()).toEqual(["Τεχνικές Υπηρεσίες", "Ασφάλεια"]);
    expect(screen.queryByText("Ρόλοι ανά χώρο")).not.toBeInTheDocument();
  });

  it("offers a clinical approver every unit role and the area roles", () => {
    renderWithIntl(<ApproverScopesEditor {...editor} roles={["clinical_approver"]} />);
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

/**
 * Owner decision 26/11/2026: one «Αποθήκευση» for the whole sheet. The
 * approver section hands its changes to the sheet, which sends them with the
 * roles, so ticking a role and adding its scope is one save.
 */
describe("S24 Χρήστες — one save for roles and approver scopes", () => {
  const shared = { open: true, catalogue: roleCatalogue, orgUnits, onClose: vi.fn() };

  it("has a single save button, the sheet's", () => {
    saved.scopes = { areas: [], units: [] };
    const clinical = { ...users[1], roles: ["clinical_approver" as const] };
    renderWithIntl(<UserSheet {...shared} user={clinical} onSave={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "Αποθήκευση" })).toHaveLength(1);
    expect(screen.getByText(/μαζί με τους ρόλους/)).toBeInTheDocument();
  });

  it("ticks a role, adds the scope it allows and saves both in one go", async () => {
    saved.scopes = { areas: [], units: [] };
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithIntl(<UserSheet {...shared} user={users[1]} onSave={onSave} />);
    // A project engineer: no approver section until the role is ticked.
    expect(screen.queryByText("Χώροι και ρόλοι έγκρισης")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Εγκρίνων τεχνικών και ασφάλειας" }));
    expect(screen.getByText("Χώροι και ρόλοι έγκρισης")).toBeInTheDocument();
    // The unit picker defaults to the first unit and the role to TECHNICAL.
    await user.click(screen.getByRole("button", { name: "Προσθήκη" }));
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      roles: ["project_engineer", "technical_approver"],
      approverScopes: { areas: [], units: [{ orgUnitId: orgUnits[0].id, role: "TECHNICAL" }] },
    });
  });

  it("sends no scopes when the approver section was not touched", async () => {
    saved.scopes = { areas: [], units: [{ orgUnitId: orgUnits[0].id, role: "NURSING" }] };
    const user = userEvent.setup();
    const onSave = vi.fn();
    const clinical = { ...users[1], roles: ["clinical_approver" as const] };
    renderWithIntl(<UserSheet {...shared} user={clinical} onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty("approverScopes");
  });

  it("keeps the section open while a saved role is unticked, so its scopes can go in the same save", async () => {
    saved.scopes = { areas: [], units: [{ orgUnitId: orgUnits[0].id, role: "NURSING" }] };
    const user = userEvent.setup();
    const onSave = vi.fn();
    const clinical = { ...users[1], roles: ["clinical_approver" as const] };
    renderWithIntl(<UserSheet {...shared} user={clinical} onSave={onSave} />);

    await user.click(screen.getByRole("checkbox", { name: "Κλινικός εγκριτής" }));
    expect(screen.getByText("Χώροι και ρόλοι έγκρισης")).toBeInTheDocument();
    // The saved scope the roles no longer allow is listed, with a word on why it is inert.
    expect(screen.getByText(/δεν φέρνουν γραμμές έγκρισης/)).toBeInTheDocument();
    const section = screen.getByText("Ρόλοι ανά μονάδα").closest("div") as HTMLElement;
    await user.click(within(section).getByRole("button", { name: "Κλείσιμο" }));
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));

    expect(onSave.mock.calls[0][0]).toMatchObject({
      roles: [],
      approverScopes: { areas: [], units: [] },
    });
  });
});
