import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { CashflowPlanImportResult } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { CashflowSection } from "./CashflowSection";
import { buildCashflowPlan, buildCashflowRows } from "./fixture";

const noop = () => undefined;
const eur = (value: number) => formatEUR(value).replace(/\s/g, " ");

function renderSection(overrides: Partial<Parameters<typeof CashflowSection>[0]> = {}) {
  const onSavePlan = vi.fn(async () => undefined);
  const onImportPlan = vi.fn(async (): Promise<CashflowPlanImportResult> => ({ saved: true, errors: [], plan: buildCashflowPlan() }));
  const utils = renderWithIntl(
    <CashflowSection
      rows={buildCashflowRows()}
      state="default"
      from="2026-01"
      to="2026-03"
      onRangeChange={noop}
      plan={buildCashflowPlan()}
      canEditPlan
      onSavePlan={onSavePlan}
      onImportPlan={onImportPlan}
      planTemplateHref={(from, to) => `/template.xlsx?from=${from}&to=${to}`}
      {...overrides}
    />,
  );
  return { ...utils, onSavePlan, onImportPlan };
}

describe("CashflowSection — the cash-flow plan (ADR-0037)", () => {
  it("shows months as mm/yyyy", () => {
    renderSection();
    expect(screen.getAllByText("01/2026").length).toBeGreaterThan(0);
    expect(screen.queryByText("2026-01")).not.toBeInTheDocument();
  });

  // RULE (ADR-0037): the screen says where «Προγραμματισμένα» comes from.
  it("says the planned figures come from the plan, or from the budget when there is none", () => {
    const { unmount } = renderSection();
    expect(screen.getByTestId("cashflow-source")).toHaveTextContent("από το πλάνο ταμειακής ροής");
    unmount();
    renderSection({ plan: buildCashflowPlan({ months: [], total: 0, difference: -2_400_000, updatedAt: null, updatedByName: null }) });
    expect(screen.getByTestId("cashflow-source")).toHaveTextContent("ισόποσα ανά μήνα");
  });

  it("offers «Επεξεργασία πλάνου» only to whoever writes the budget", () => {
    const { unmount } = renderSection({ canEditPlan: false });
    expect(screen.queryByRole("button", { name: "Επεξεργασία πλάνου" })).not.toBeInTheDocument();
    unmount();
    renderSection();
    expect(screen.getByRole("button", { name: "Επεξεργασία πλάνου" })).toBeInTheDocument();
  });

  it("edits a month, keeps the total and the difference live, and saves the whole plan", async () => {
    const { onSavePlan } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Επεξεργασία πλάνου" }));
    const editor = screen.getByTestId("cashflow-plan-editor");

    expect(within(editor).getByTestId("cashflow-plan-total")).toHaveTextContent(eur(400_000));
    expect(within(editor).getByTestId("cashflow-plan-approved")).toHaveTextContent(eur(2_400_000));
    expect(within(editor).getByTestId("cashflow-plan-difference")).toHaveTextContent(eur(-2_000_000));

    fireEvent.change(within(editor).getByLabelText("Ποσό (€) 03/2026"), { target: { value: "1.000.000,50" } });
    fireEvent.change(within(editor).getByLabelText("Σημείωση 03/2026"), { target: { value: "Παραλαβή εξοπλισμού" } });
    fireEvent.change(within(editor).getByLabelText("Ποσό (€) 02/2026"), { target: { value: "" } });

    // 150.000 + 1.000.000,50 — February emptied is out of the plan.
    expect(within(editor).getByTestId("cashflow-plan-total")).toHaveTextContent(eur(1_150_000.5));
    expect(within(editor).getByTestId("cashflow-plan-difference")).toHaveTextContent(eur(-1_249_999.5));

    await act(async () => {
      fireEvent.click(within(editor).getByRole("button", { name: "Αποθήκευση" }));
    });
    expect(onSavePlan).toHaveBeenCalledWith([
      { period: "2026-01", amount: 150_000, note: "Κινητοποίηση αναδόχου" },
      { period: "2026-03", amount: 1_000_000.5, note: "Παραλαβή εξοπλισμού" },
    ]);
    // Saved: the editor closes.
    expect(screen.queryByTestId("cashflow-plan-editor")).not.toBeInTheDocument();
  });

  it("does not save a negative or unreadable amount", async () => {
    const { onSavePlan } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Επεξεργασία πλάνου" }));
    const editor = screen.getByTestId("cashflow-plan-editor");
    fireEvent.change(within(editor).getByLabelText("Ποσό (€) 01/2026"), { target: { value: "-5" } });
    expect(within(editor).getByText("Γράψτε ποσό μηδέν ή μεγαλύτερο.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(editor).getByRole("button", { name: "Αποθήκευση" }));
    });
    expect(onSavePlan).not.toHaveBeenCalled();
    expect(within(editor).getByRole("alert")).toHaveTextContent("Διορθώστε τα ποσά");
  });

  it("links the template for the editor's window", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Επεξεργασία πλάνου" }));
    expect(screen.getByRole("link", { name: "Λήψη προτύπου" })).toHaveAttribute("href", "/template.xlsx?from=2026-01&to=2026-03");
  });

  // RULE (owner): all or nothing, and every bad row named.
  it("lists the rows of a refused import and says nothing was saved", async () => {
    const onImportPlan = vi.fn(
      async (): Promise<CashflowPlanImportResult> => ({
        saved: false,
        plan: null,
        errors: [
          { row: 4, problem: "periodNotValid", value: "13/2026" },
          { row: 5, problem: "amountNegative", value: "-10" },
        ],
      }),
    );
    renderSection({ onImportPlan });
    fireEvent.click(screen.getByRole("button", { name: "Επεξεργασία πλάνου" }));
    const file = new File(["x"], "plan.xlsx");
    fireEvent.change(screen.getByLabelText("Αρχείο .xlsx"), { target: { files: [file] } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Εισαγωγή από Excel" }));
    });
    expect(onImportPlan).toHaveBeenCalledWith(file);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Δεν αποθηκεύτηκε τίποτα");
    expect(status).toHaveTextContent("Ο μήνας δεν είναι της μορφής μμ/εεεε: «13/2026».");
    expect(status).toHaveTextContent("Το ποσό είναι αρνητικό: «-10».");
  });
});
