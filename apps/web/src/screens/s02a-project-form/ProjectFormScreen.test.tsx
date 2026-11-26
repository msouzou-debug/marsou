import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OrgUnit } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { ApiError } from "@/data/client";
import { ProjectFormScreen } from "./ProjectFormScreen";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const apiMutate = vi.fn();
vi.mock("@/data/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/client")>();
  return { ...actual, apiMutate: (...args: unknown[]) => apiMutate(...args) };
});

const orgUnits: OrgUnit[] = [
  {
    id: "nicosia-general",
    code: "NGH",
    nameEl: "Γενικό Νοσοκομείο Λευκωσίας",
    nameEn: "Nicosia General Hospital",
    type: "HOSPITAL",
    directorate: "LEFKOSIAS",
    costCentre: null,
    entityCode: null,
    efinanceCode: null,
    timezone: "Europe/Nicosia",
  },
];

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText("Τίτλος"), "Ανακαίνιση θαλάμου");
  await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
}

describe("ProjectFormScreen error routing", () => {
  // RULE (ADR-0014, decided 19/09/2026): a 403 errors.budgetFinanceOnly is
  // routed next to the budget field, not into the general strip.
  it("puts a 403 errors.budgetFinanceOnly next to the budget field", async () => {
    apiMutate.mockRejectedValueOnce(
      new ApiError("Μόνο η Οικονομική Διεύθυνση μπορεί να αλλάξει τον προϋπολογισμό μετά την έγκριση.", 403, "errors.budgetFinanceOnly"),
    );
    renderWithIntl(<ProjectFormScreen mode="create" orgUnits={orgUnits} />);

    await fillAndSubmit();

    expect(
      await screen.findByText("Μόνο η Οικονομική Διεύθυνση μπορεί να αλλάξει τον προϋπολογισμό μετά την έγκριση."),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("puts any other failure in the general strip instead", async () => {
    apiMutate.mockRejectedValueOnce(new ApiError("Δεν έχετε δικαίωμα για αυτή την ενέργεια.", 403, "errors.readOnlyAccount"));
    renderWithIntl(<ProjectFormScreen mode="create" orgUnits={orgUnits} />);

    await fillAndSubmit();

    expect(await screen.findByText("Δεν έχετε δικαίωμα για αυτή την ενέργεια.")).toBeInTheDocument();
  });

  // OWNER 26/11/2026 (ADR-0014): finance's edit sends the approved budget
  // and nothing else, whatever else the form was prefilled with.
  it("sends only the approved budget in finance's budget-only edit", async () => {
    apiMutate.mockResolvedValueOnce({ id: "PRJ-1" });
    renderWithIntl(
      <ProjectFormScreen
        mode="edit"
        orgUnits={[]}
        projectId="PRJ-1"
        budgetOnly
        initialValues={{
          titleEl: "Ανακαίνιση χειρουργείων",
          titleEn: null,
          category: "RENOVATION",
          fundingSource: "STATE_BUDGET",
          approvedBudget: 2_000_000,
          plannedStart: "2026-01-01",
          plannedFinish: "2026-12-01",
          budgetYearFrom: null,
          budgetYearTo: null,
          sapWbs: null,
          tenderReference: null,
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Αλλαγή εγκεκριμένου προϋπολογισμού" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Τίτλος")).toBeNull();
    const budget = screen.getByLabelText("Εγκεκριμένος προϋπολογισμός (με ΦΠΑ)");
    await userEvent.clear(budget);
    await userEvent.type(budget, "2345678.9");
    // The preview follows the app-wide money rule (`formatEUR`): whole euros from 1.000 up.
    expect(screen.getByText(/^2\.345\.679\s€$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));

    expect(apiMutate).toHaveBeenCalledWith("/projects/PRJ-1", "PATCH", { approvedBudget: 2_345_678.9 }, expect.anything());
    expect(push).toHaveBeenCalledWith("/projects/PRJ-1");
  });

  it("navigates to the new project's own page on success", async () => {
    apiMutate.mockResolvedValueOnce({ id: "PRJ-9" });
    renderWithIntl(<ProjectFormScreen mode="create" orgUnits={orgUnits} />);

    await fillAndSubmit();

    expect(push).toHaveBeenCalledWith("/projects/PRJ-9");
  });
});
