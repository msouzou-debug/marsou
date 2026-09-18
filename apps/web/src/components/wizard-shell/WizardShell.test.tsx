import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { WizardShell, type WizardStep } from "./WizardShell";

const steps: WizardStep[] = [
  { id: "system", label: "Σύστημα" },
  { id: "areas", label: "Χώροι που επηρεάζονται" },
  { id: "dates", label: "Ημερομηνία και διάρκεια" },
  { id: "review", label: "Επισκόπηση" },
];

describe("WizardShell", () => {
  it("labels the forward button Continue on a middle step", () => {
    renderWithIntl(
      <WizardShell steps={steps} current={0} canContinue onBack={() => {}} onNext={() => {}}>
        <p>step body</p>
      </WizardShell>,
    );
    expect(screen.getByRole("button", { name: "Συνέχεια" })).toBeInTheDocument();
  });

  it("labels the forward button Submit on the last step", () => {
    renderWithIntl(
      <WizardShell steps={steps} current={3} canContinue onBack={() => {}} onNext={() => {}}>
        <p>step body</p>
      </WizardShell>,
    );
    expect(screen.getByRole("button", { name: "Υποβολή" })).toBeInTheDocument();
  });

  it("disables Back on the first step and forward when canContinue is false", () => {
    renderWithIntl(
      <WizardShell steps={steps} current={0} canContinue={false} onBack={() => {}} onNext={() => {}}>
        <p>step body</p>
      </WizardShell>,
    );
    expect(screen.getByRole("button", { name: "Επιστροφή" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Συνέχεια" })).toBeDisabled();
  });

  it("calls onStepChange with the target index before onBack/onNext", async () => {
    const onStepChange = vi.fn();
    const onNext = vi.fn();
    renderWithIntl(
      <WizardShell
        steps={steps}
        current={1}
        canContinue
        onBack={() => {}}
        onNext={onNext}
        onStepChange={onStepChange}
      >
        <p>step body</p>
      </WizardShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Συνέχεια" }));
    expect(onStepChange).toHaveBeenCalledWith(2);
    expect(onNext).toHaveBeenCalledOnce();
  });
});
