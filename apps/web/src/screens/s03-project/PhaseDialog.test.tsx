import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { PhaseDialog } from "./PhaseDialog";

describe("PhaseDialog", () => {
  // RULE (R04): a project moves exactly one step forward; only the next
  // phase is offered to an ordinary writer.
  it("offers only the next phase to an estates head, with no direction choice to make", () => {
    renderWithIntl(
      <PhaseDialog open currentPhase="PREPARATION" isAdmin={false} submitting={false} onCancel={() => {}} onSubmit={() => {}} />,
    );
    expect(screen.getByText("Προετοιμασία → Εγκεκριμένο")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  // RULE (R04): an administrator may additionally move a project backwards.
  it("also offers the previous phase to an admin, forward preselected", () => {
    renderWithIntl(
      <PhaseDialog open currentPhase="PREPARATION" isAdmin submitting={false} onCancel={() => {}} onSubmit={() => {}} />,
    );
    const forward = screen.getByRole("radio", { name: /Εγκεκριμένο/ });
    const backward = screen.getByRole("radio", { name: /Ιδέα/ });
    expect(forward).toBeChecked();
    expect(backward).not.toBeChecked();
  });

  it("blocks submission and shows the required error when no reason is typed", async () => {
    const onSubmit = vi.fn();
    renderWithIntl(
      <PhaseDialog open currentPhase="IDEA" isAdmin={false} submitting={false} onCancel={() => {}} onSubmit={onSubmit} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Υποβολή" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Συμπληρώστε αυτό το πεδίο.")).toBeInTheDocument();
  });

  it("submits the next phase and the typed reason once both are there", async () => {
    const onSubmit = vi.fn();
    renderWithIntl(
      <PhaseDialog open currentPhase="IDEA" isAdmin={false} submitting={false} onCancel={() => {}} onSubmit={onSubmit} />,
    );
    await userEvent.type(screen.getByLabelText("Αιτιολογία"), "Η μελέτη σκοπιμότητας εγκρίθηκε.");
    await userEvent.click(screen.getByRole("button", { name: "Υποβολή" }));
    expect(onSubmit).toHaveBeenCalledWith("PREPARATION", "Η μελέτη σκοπιμότητας εγκρίθηκε.");
  });

  // RULE (R04): errors.gateOpen names the open gate; when the screen can
  // resolve which milestone that is, the dialog links straight to its card.
  it("shows the gateOpen message with a link to the named milestone's card", () => {
    renderWithIntl(
      <PhaseDialog
        open
        currentPhase="PREPARATION"
        isAdmin={false}
        submitting={false}
        apiError={{ message: "Το ορόσημο «Έγκριση μελέτης» κλείνει το τρέχον στάδιο…", gateMilestoneId: "m-1" }}
        onCancel={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText(/Έγκριση μελέτης/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Δείτε το ορόσημο" });
    expect(link).toHaveAttribute("href", "#milestone-m-1");
  });

  it("returns nothing for a project already at the last phase", () => {
    const { container } = renderWithIntl(
      <PhaseDialog open currentPhase="CLOSED" isAdmin={false} submitting={false} onCancel={() => {}} onSubmit={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
