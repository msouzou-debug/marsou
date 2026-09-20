import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OrgUnit } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { ProjectForm } from "./ProjectForm";

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

function renderForm(overrides: Partial<ComponentProps<typeof ProjectForm>> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  renderWithIntl(
    <ProjectForm
      mode="create"
      orgUnits={orgUnits}
      submitting={false}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onSubmit, onCancel };
}

describe("ProjectForm validation", () => {
  it("shows the required error and blocks submit when the title is empty", async () => {
    const { onSubmit } = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Συμπληρώστε αυτό το πεδίο.")).toBeInTheDocument();
  });

  // RULE: finish before start is refused client-side (`schema.ts`'s
  // `refineDateOrder`), same message the API's own validation would use.
  it("blocks submit when the planned finish is before the planned start", async () => {
    const { onSubmit } = renderForm();
    await userEvent.type(screen.getByLabelText("Τίτλος"), "Ανακαίνιση θαλάμου");
    fireEvent.change(screen.getByLabelText("Προγραμματισμένη έναρξη"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("Προγραμματισμένη ολοκλήρωση"), { target: { value: "2026-01-01" } });

    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Η ημερομηνία ολοκλήρωσης δεν μπορεί να είναι πριν την ημερομηνία έναρξης.")).toBeInTheDocument();
  });

  it("submits once every required field is valid", async () => {
    const { onSubmit } = renderForm();
    await userEvent.type(screen.getByLabelText("Τίτλος"), "Ανακαίνιση θαλάμου");
    await userEvent.clear(screen.getByLabelText("Εγκεκριμένος προϋπολογισμός"));
    await userEvent.type(screen.getByLabelText("Εγκεκριμένος προϋπολογισμός"), "125000");

    await userEvent.click(screen.getByRole("button", { name: "Αποθήκευση" }));

    expect(onSubmit).toHaveBeenCalledOnce();
    const values = onSubmit.mock.calls[0][0];
    expect(values.titleEl).toBe("Ανακαίνιση θαλάμου");
    expect(values.approvedBudget).toBe(125000);
  });
});

describe("ProjectForm API errors", () => {
  // RULE (ADR-0014, decided 19/09/2026): finance-only after APPROVED — the
  // field message, not the general strip.
  it("shows budgetFieldError next to the budget field, separately from the general apiError strip", () => {
    renderForm({
      apiError: "Δεν έχετε πρόσβαση για αυτή την ενέργεια.",
      budgetFieldError: "Μόνο η Οικονομική Διεύθυνση μπορεί να αλλάξει τον προϋπολογισμό μετά την έγκριση.",
    });
    const budgetField = screen.getByLabelText("Εγκεκριμένος προϋπολογισμός");
    const budgetMessage = screen.getByText(
      "Μόνο η Οικονομική Διεύθυνση μπορεί να αλλάξει τον προϋπολογισμό μετά την έγκριση.",
    );
    const stripMessage = screen.getByText("Δεν έχετε πρόσβαση για αυτή την ενέργεια.");
    // The budget message sits right after the budget field's own container,
    // not down by the strip near the buttons.
    expect(budgetField.compareDocumentPosition(budgetMessage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(budgetMessage.compareDocumentPosition(stripMessage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides the Μονάδα field entirely in edit mode", () => {
    renderForm({ mode: "edit", initialValues: { titleEl: "x", titleEn: null, category: "NEW_BUILD", fundingSource: "STATE_BUDGET", approvedBudget: 1, plannedStart: null, plannedFinish: null, budgetYearFrom: null, budgetYearTo: null, sapWbs: null, tenderReference: null } });
    expect(screen.queryByLabelText("Μονάδα")).not.toBeInTheDocument();
  });
});

describe("ProjectForm submitting state", () => {
  it("disables the save button and shows the saving label while submitting", () => {
    renderForm({ submitting: true });
    expect(screen.getByRole("button", { name: /Γίνεται αποθήκευση/ })).toBeDisabled();
  });
});
