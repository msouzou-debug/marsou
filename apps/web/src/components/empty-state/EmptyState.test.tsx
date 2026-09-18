import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the message and calls onAction when the button is pressed", async () => {
    const onAction = vi.fn();
    renderWithIntl(
      <EmptyState
        message="Δεν υπάρχουν ανοιχτές εντολές εργασίας για αυτό το πάγιο."
        actionLabel="Νέα εντολή"
        onAction={onAction}
      />,
    );

    expect(
      screen.getByText("Δεν υπάρχουν ανοιχτές εντολές εργασίας για αυτό το πάγιο."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Νέα εντολή" }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});
