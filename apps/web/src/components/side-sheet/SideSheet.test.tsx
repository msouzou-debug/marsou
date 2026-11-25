import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { SideSheet } from "./SideSheet";

// OWNER UAT 25/11/2026: «there is no close button; it stays in limbo» and
// «the fields date due and status remain in the view area».
describe("SideSheet", () => {
  it("has a visible «Πίσω στη λίστα» button at the top that closes it", async () => {
    const onClose = vi.fn();
    renderWithIntl(
      <SideSheet title="Αίτημα διευκρίνισης 2" onClose={onClose}>
        <p>σώμα</p>
      </SideSheet>,
    );
    const back = screen.getByRole("button", { name: "Πίσω στη λίστα" });
    expect(back).toBeVisible();
    await userEvent.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderWithIntl(<SideSheet title="Τίτλος" onClose={onClose}>σώμα</SideSheet>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape to a confirm dialog open on top of it", () => {
    const onClose = vi.fn();
    renderWithIntl(
      <SideSheet title="Τίτλος" onClose={onClose}>
        <dialog open>επιβεβαίωση</dialog>
      </SideSheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a click on the backdrop", async () => {
    const onClose = vi.fn();
    renderWithIntl(<SideSheet title="Τίτλος" onClose={onClose}>σώμα</SideSheet>);
    await userEvent.click(screen.getByTestId("side-sheet-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("sits above the top bar (z-30) and the table's sticky header (z-10)", () => {
    renderWithIntl(<SideSheet title="Τίτλος" onClose={() => {}}>σώμα</SideSheet>);
    expect(screen.getByRole("dialog", { name: "Τίτλος" }).className).toMatch(/\bz-40\b/);
    expect(screen.getByTestId("side-sheet-backdrop").className).toMatch(/\bz-40\b/);
  });
});
