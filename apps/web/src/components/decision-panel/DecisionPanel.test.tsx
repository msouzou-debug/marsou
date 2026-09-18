import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { DecisionPanel, type DecisionFact } from "./DecisionPanel";

const facts: DecisionFact[] = [
  { label: "Σύστημα", value: "Κλιματισμός Πτέρυγας Β" },
  { label: "Διάρκεια", value: "3 ημ" },
  { label: "Ζητήθηκε από", value: "Γ. Νικολάου" },
];

function setup(overrides: Partial<Parameters<typeof DecisionPanel>[0]> = {}) {
  const onApprove = vi.fn();
  const onReturn = vi.fn();
  const onForward = vi.fn();
  const onClose = vi.fn();
  renderWithIntl(
    <DecisionPanel
      what="Αίτημα διακοπής"
      where="Νοσοκομείο Λευκωσίας › Πτέρυγα Β"
      facts={facts}
      onApprove={onApprove}
      onReturn={onReturn}
      onForward={onForward}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onApprove, onReturn, onForward, onClose };
}

describe("DecisionPanel", () => {
  it("RULE: throws in development when facts.length is not exactly three", () => {
    const bad = [...facts, { label: "extra", value: "x" }];
    expect(() =>
      renderWithIntl(
        <DecisionPanel
          what="x"
          where="y"
          facts={bad}
          onApprove={() => {}}
          onReturn={() => {}}
          onClose={() => {}}
        />,
      ),
    ).toThrow(/exactly three facts/);
  });

  it("renders exactly the three provided facts and nothing else record-like", () => {
    setup();
    for (const fact of facts) {
      expect(screen.getByText(fact.label)).toBeInTheDocument();
      expect(screen.getByText(fact.value)).toBeInTheDocument();
    }
  });

  it("keyboard: a approves, x closes, f forwards", async () => {
    const { onApprove, onClose, onForward } = setup();
    await userEvent.keyboard("a");
    expect(onApprove).toHaveBeenCalledOnce();
    await userEvent.keyboard("f");
    expect(onForward).toHaveBeenCalledOnce();
    await userEvent.keyboard("x");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("requires a non-empty comment before the return button submits", async () => {
    const { onReturn } = setup();
    const returnButton = screen.getByRole("button", { name: "Επιστροφή με σχόλια" });

    // First click only reveals the textarea; return has not fired.
    await userEvent.click(returnButton);
    expect(onReturn).not.toHaveBeenCalled();
    expect(returnButton).toBeDisabled();

    const textarea = screen.getByPlaceholderText("Γράψτε το σχόλιό σας");
    await userEvent.type(textarea, "Χρειάζεται νέα ημερομηνία");
    expect(returnButton).toBeEnabled();

    await userEvent.click(returnButton);
    expect(onReturn).toHaveBeenCalledWith("Χρειάζεται νέα ημερομηνία");
  });

  it("keyboard r reveals the comment box without submitting", async () => {
    const { onReturn } = setup();
    await userEvent.keyboard("r");
    const textarea = await screen.findByPlaceholderText("Γράψτε το σχόλιό σας");
    expect(textarea).toBeInTheDocument();
    expect(onReturn).not.toHaveBeenCalled();
    // Submitting the typed comment is covered by the click-based test above
    // ("requires a non-empty comment…") — once focus is inside the
    // textarea, a/r/f/x are plain letters, not shortcuts (next test).
  });

  it("ignores the a/r/f/x shortcuts while typing in the comment textarea", async () => {
    const { onApprove } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Επιστροφή με σχόλια" }));
    const textarea = screen.getByPlaceholderText("Γράψτε το σχόλιό σας");
    await userEvent.type(textarea, "a");
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("shows skeleton facts while loading", () => {
    setup({ loading: true, facts: [] as unknown as DecisionFact[] });
    expect(screen.queryByText("Σύστημα")).not.toBeInTheDocument();
  });
});
