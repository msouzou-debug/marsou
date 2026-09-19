import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { ControlsChecklist } from "./ControlsChecklist";

const CONTROLS = [
  { id: "IV-01", textEl: "Απομόνωση με πλαστικό φράγμα", textEn: "Isolate with plastic barrier", phase: "DURING" as const },
  { id: "IV-02", textEl: "Καθαρισμός μετά την ολοκλήρωση", textEn: "Clean on completion", phase: "ON_COMPLETION" as const },
];

describe("ControlsChecklist", () => {
  it("renders every control as read-only text plus an acknowledge checkbox", () => {
    renderWithIntl(<ControlsChecklist controls={CONTROLS} acknowledgedIds={[]} onToggle={vi.fn()} />);
    expect(screen.getByText("Απομόνωση με πλαστικό φράγμα")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("fires onToggle with the control id", async () => {
    const onToggle = vi.fn();
    renderWithIntl(<ControlsChecklist controls={CONTROLS} acknowledgedIds={["IV-01"]} onToggle={onToggle} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    await userEvent.click(boxes[1]);
    expect(onToggle).toHaveBeenCalledWith("IV-02");
  });

  it("shows the empty sentence when there are no controls", () => {
    renderWithIntl(<ControlsChecklist controls={[]} acknowledgedIds={[]} onToggle={vi.fn()} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
