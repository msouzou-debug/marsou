import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { isAdmin } from "@/auth/roles";
import { Users, type UsersFilters } from "./Users";
import { coversAllUnits, needsAUnit } from "./schema";
import { orgUnits, roleCatalogue, users } from "./fixture";

const filters: UsersFilters = { q: "", role: "", unit: "", active: "" };

const shared = {
  catalogue: roleCatalogue,
  orgUnits,
  filters,
  onFilters: vi.fn(),
  noPermission: <div>Δεν έχετε πρόσβαση</div>,
};

/**
 * RULE (ADR-0020): `/admin/users` is gated to `admin` in the page's own
 * Server Component, before `UsersScreen` is ever rendered. Testing the
 * predicate the page calls is the faithful unit test for "NoPermission for a
 * head of estates", since the gate is an `if`, not a prop.
 */
describe("S24 Χρήστες — who may open the page (ADR-0020)", () => {
  it("admits an administrator and refuses everybody else", () => {
    expect(isAdmin(["admin"])).toBe(true);
    expect(isAdmin(["estates_head"])).toBe(false);
    expect(isAdmin(["finance"])).toBe(false);
    expect(isAdmin(["auditor_readonly"])).toBe(false);
  });

  it("draws the NoPermission body it is handed", () => {
    renderWithIntl(<Users {...shared} state="noPermission" onSelect={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText("Δεν έχετε πρόσβαση")).toBeInTheDocument();
  });
});

describe("S24 Χρήστες — the table", () => {
  it("shows «Όλες» for an all-units role and the unit codes for a unit role", () => {
    renderWithIntl(<Users {...shared} data={users} state="default" onSelect={vi.fn()} onSave={vi.fn()} />);
    const adminRow = screen.getByText("Μαρία Κωνσταντίνου").closest("tr");
    expect(within(adminRow as HTMLElement).getByText("Όλες")).toBeInTheDocument();

    const engineerRow = screen.getByText("Ελένη Χριστοδούλου").closest("tr");
    expect(within(engineerRow as HTMLElement).getByText("LAR")).toBeInTheDocument();
  });

  it("marks an account that has never signed in, and one that is switched off", () => {
    renderWithIntl(<Users {...shared} data={users} state="default" onSelect={vi.fn()} onSave={vi.fn()} />);
    const engineerRow = screen.getByText("Ελένη Χριστοδούλου").closest("tr");
    expect(within(engineerRow as HTMLElement).getByText("—")).toBeInTheDocument();

    const auditorRow = screen.getByText("Χριστίνα Λοΐζου").closest("tr");
    expect(within(auditorRow as HTMLElement).getByText("Ανενεργός")).toBeInTheDocument();
  });
});

describe("S24 Χρήστες — the sheet (ADR-0020)", () => {
  it("RULE: the auditor checkbox is there and cannot be moved from here", () => {
    renderWithIntl(
      <Users {...shared} data={users} state="default" selectedId="user-2" onSelect={vi.fn()} onSave={vi.fn()} />,
    );
    const auditor = screen.getByRole("checkbox", { name: "Ελεγκτής" });
    expect(auditor).toBeDisabled();
    const engineer = screen.getByRole("checkbox", { name: "Μηχανικός έργου" });
    expect(engineer).toBeEnabled();
    expect(engineer).toBeChecked();
  });

  it("RULE: the unit list is switched off while every ticked role covers all units", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <Users {...shared} data={users} state="default" selectedId="user-2" onSelect={vi.fn()} onSave={vi.fn()} />,
    );
    const units = screen.getByRole("listbox", { name: "Μονάδες" });
    expect(units).toBeEnabled();

    // Ticking `finance`, which reaches every unit, takes the choice away.
    await user.click(screen.getByRole("checkbox", { name: "Οικονομική Διεύθυνση" }));
    expect(screen.getByRole("listbox", { name: "Μονάδες" })).toBeDisabled();
    expect(screen.getByText("Οι ρόλοι που επιλέξατε ισχύουν για όλες τις μονάδες.")).toBeInTheDocument();
  });

  it("RULE: a unit role with no unit is refused before the request is made", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithIntl(
      <Users {...shared} data={users} state="default" selectedId="user-2" onSelect={vi.fn()} onSave={onSave} />,
    );
    // Deselect Larnaca, leaving `project_engineer` with nothing.
    const units = screen.getByRole("listbox", { name: "Μονάδες" }) as HTMLSelectElement;
    await user.deselectOptions(units, ["larnaca-general"]);
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByText("Επιλέξτε τουλάχιστον μία μονάδα.").length).toBeGreaterThan(0);
  });

  it("shows the API's own sentence when the administrator locks themselves out", () => {
    const sentence =
      "Δεν αφαιρείτε τον δικό σας ρόλο διαχειριστή και δεν απενεργοποιείτε τον δικό σας λογαριασμό. Ζητήστε από άλλον διαχειριστή να κάνει την αλλαγή.";
    renderWithIntl(
      <Users
        {...shared}
        data={users}
        state="default"
        selectedId="user-1"
        sheetApiError={sentence}
        onSelect={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(sentence);
  });

  it("asks before switching an account off", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderWithIntl(
      <Users {...shared} data={users} state="default" selectedId="user-2" onSelect={vi.fn()} onSave={onSave} />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Ενεργός λογαριασμός" }));
    await user.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText("Απενεργοποιείτε τον λογαριασμό Ελένη Χριστοδούλου;"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Απενεργοποίηση" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it("the «Προσθήκη» form carries the hint about the first sign-in", () => {
    renderWithIntl(
      <Users {...shared} data={users} state="default" selectedId="new" onSelect={vi.fn()} onSave={vi.fn()} />,
    );
    expect(
      screen.getByText(
        "Ο χρήστης θα συνδεθεί με τον λογαριασμό ΟΚΥπΥ του· τα δικαιώματα ισχύουν από την πρώτη σύνδεση.",
      ),
    ).toBeInTheDocument();
  });
});

describe("role scope helpers (ADR-0020)", () => {
  it("reads the scope from the catalogue rather than hardcoding the four", () => {
    expect(coversAllUnits(roleCatalogue, ["finance"])).toBe(true);
    expect(coversAllUnits(roleCatalogue, ["project_engineer"])).toBe(false);
    expect(needsAUnit(roleCatalogue, ["project_engineer"])).toBe(true);
    expect(needsAUnit(roleCatalogue, ["project_engineer", "admin"])).toBe(false);
    expect(needsAUnit(roleCatalogue, [])).toBe(false);
  });
});
