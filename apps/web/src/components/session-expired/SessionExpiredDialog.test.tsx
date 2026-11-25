import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { announceSessionExpired } from "@/data/session-expiry";
import { SessionExpiredDialog } from "./SessionExpiredDialog";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

// OWNER UAT 25/11/2026: «RFI save: Request to /contracts/<id>/rfis failed with 401».
describe("SessionExpiredDialog", () => {
  it("stays hidden until a 401 is announced", () => {
    renderWithIntl(<SessionExpiredDialog />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("says the session expired, warns about unsaved text, and offers sign-in back to the same page", () => {
    window.history.replaceState(null, "", "/contracts/c-1/rfis?tab=open");
    renderWithIntl(<SessionExpiredDialog />);
    act(() => announceSessionExpired());

    const dialog = screen.getByRole("alertdialog", { name: "Η σύνδεσή σας έληξε. Συνδεθείτε ξανά." });
    expect(dialog).toHaveAccessibleDescription(/δεν αποθηκεύτηκε χάνεται αν συνδεθείτε από εδώ/);
    const expected = "/sign-in?expired=1&next=%2Fcontracts%2Fc-1%2Frfis%3Ftab%3Dopen";
    expect(screen.getByRole("link", { name: "Σύνδεση" })).toHaveAttribute("href", expected);
    const newTab = screen.getByRole("link", { name: "Σύνδεση σε νέα καρτέλα" });
    expect(newTab).toHaveAttribute("href", expected);
    expect(newTab).toHaveAttribute("target", "_blank");
  });

  it("lets the user stay on the page to copy what they typed", async () => {
    renderWithIntl(<SessionExpiredDialog initiallyOpen />);
    await userEvent.click(screen.getByRole("button", { name: "Παραμονή στη σελίδα" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closes on Escape", () => {
    renderWithIntl(<SessionExpiredDialog initiallyOpen />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("speaks English when the app does", () => {
    renderWithIntl(<SessionExpiredDialog initiallyOpen />, { locale: "en" });
    expect(screen.getByRole("alertdialog", { name: "Your session has expired. Sign in again." })).toBeVisible();
  });
});
