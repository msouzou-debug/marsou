import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { PasswordEditor } from "./PasswordEditor";
import { UserSheet } from "./UserSheet";
import { orgUnits, roleCatalogue, users } from "./fixture";

const mutate = vi.hoisted(() => vi.fn());
vi.mock("@/data/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/client")>();
  return { ...actual, apiMutate: mutate };
});

/** ADR-0030 — the password block of Διαχείριση › Χρήστες, local mode only. */
describe("S24 Χρήστες — eCapital password (ADR-0030)", () => {
  it("is drawn only when the deployment signs people in with eCapital passwords", () => {
    const shared = { open: true, user: users[0], catalogue: roleCatalogue, orgUnits, onClose: vi.fn(), onSave: vi.fn() };
    const { unmount } = renderWithIntl(<UserSheet {...shared} />);
    expect(screen.queryByText("Κωδικός eCapital")).not.toBeInTheDocument();
    unmount();
    renderWithIntl(<UserSheet {...shared} localAccounts />);
    expect(screen.getByText("Κωδικός eCapital")).toBeInTheDocument();
  });

  it("says whether a password exists without ever showing one", () => {
    renderWithIntl(<PasswordEditor userId="u1" hasPassword={false} />);
    expect(screen.getByText("Δεν έχει οριστεί κωδικός. Ο χρήστης δεν μπορεί να συνδεθεί ακόμη.")).toBeInTheDocument();
    expect(screen.getByLabelText("Νέος κωδικός")).toHaveAttribute("type", "password");
  });

  it("refuses a short password before the API is asked", async () => {
    mutate.mockReset();
    renderWithIntl(<PasswordEditor userId="u1" />);
    await userEvent.type(screen.getByLabelText("Νέος κωδικός"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Ορισμός κωδικού" }));
    expect(screen.getByRole("alert")).toHaveTextContent("τουλάχιστον 8 χαρακτήρες");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("sends the password once, then clears the field and says it is set", async () => {
    mutate.mockReset();
    mutate.mockResolvedValue({ ...users[0], hasPassword: true });
    renderWithIntl(<PasswordEditor userId="u1" hasPassword={false} />);
    const field = screen.getByLabelText("Νέος κωδικός");
    await userEvent.type(field, "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Ορισμός κωδικού" }));
    expect(mutate).toHaveBeenCalledWith("/admin/users/u1/password", "PUT", { password: "correct horse battery" }, expect.anything());
    expect(await screen.findByRole("status")).toHaveTextContent("Ο κωδικός ορίστηκε.");
    expect(field).toHaveValue("");
    expect(screen.getByText("Έχει οριστεί κωδικός.")).toBeInTheDocument();
  });
});
