import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { SignInForm } from "./SignInForm";

// The server action is the boundary: the test asserts what reaches it, not
// what the API does with it (that is apps/api's test/auth-ldap.test.ts).
const signIn = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/auth/actions", () => ({ signIn }));

describe("SignInForm — ADR-0018, one screen and three ways in", () => {
  it("asks for an address in dev mode, and lists the seeded accounts", () => {
    renderWithIntl(<SignInForm mode="dev" showDevAccounts />);
    expect(screen.getByLabelText("Διεύθυνση ηλεκτρονικού ταχυδρομείου")).toBeInTheDocument();
    expect(screen.queryByLabelText("Κωδικός")).not.toBeInTheDocument();
    expect(screen.getByText("admin@ecapital.test")).toBeInTheDocument();
  });

  it("asks for a ΟΚΥπΥ username and password in ldap mode, and never for an address", () => {
    renderWithIntl(<SignInForm mode="ldap" showDevAccounts={false} />);
    expect(screen.getByText("Συνδεθείτε με τον λογαριασμό ΟΚΥπΥ σας.")).toBeInTheDocument();
    expect(screen.getByLabelText("Όνομα χρήστη")).toBeInTheDocument();
    expect(screen.getByLabelText("Κωδικός")).toBeInTheDocument();
    expect(screen.queryByLabelText("Διεύθυνση ηλεκτρονικού ταχυδρομείου")).not.toBeInTheDocument();
    // RULE (ADR-0018): no seeded accounts on a screen that binds against a
    // real directory — they would be eight addresses nobody can sign in with.
    expect(screen.queryByText("admin@ecapital.test")).not.toBeInTheDocument();
  });

  it("gives the password field the browser's own treatment", () => {
    renderWithIntl(<SignInForm mode="ldap" showDevAccounts={false} />);
    const password = screen.getByLabelText("Κωδικός");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autoComplete", "current-password");
  });

  it("sends the username and the password to the server action, and nothing else", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mode="ldap" next="/projects" showDevAccounts={false} />);

    await user.type(screen.getByLabelText("Όνομα χρήστη"), "apapadopoulos");
    await user.type(screen.getByLabelText("Κωδικός"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Σύνδεση" }));

    expect(signIn).toHaveBeenCalledWith("apapadopoulos", "/projects", "correct horse");
  });

  it("says what to do when the directory refuses the credentials", async () => {
    signIn.mockResolvedValueOnce({ error: "badCredentials" } as never);
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mode="ldap" showDevAccounts={false} />);

    await user.type(screen.getByLabelText("Όνομα χρήστη"), "apapadopoulos");
    await user.type(screen.getByLabelText("Κωδικός"), "wrong");
    await user.click(screen.getByRole("button", { name: "Σύνδεση" }));

    // UI instructions §6: what happened and what to do, no code.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Το όνομα χρήστη ή ο κωδικός δεν είναι σωστά");
    expect(alert.textContent).not.toMatch(/\d{3}/);
  });

  it("shows one button and no fields in oidc mode", () => {
    renderWithIntl(<SignInForm mode="oidc" showDevAccounts={false} />);
    expect(screen.queryByLabelText("Όνομα χρήστη")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Διεύθυνση ηλεκτρονικού ταχυδρομείου")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Σύνδεση με λογαριασμό ΟΚΥπΥ" })).toBeInTheDocument();
  });

  it("reads the same three ways in English", () => {
    renderWithIntl(<SignInForm mode="ldap" showDevAccounts={false} />, { locale: "en" });
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByText("Sign in with your ΟΚΥπΥ account.")).toBeInTheDocument();
  });
});
