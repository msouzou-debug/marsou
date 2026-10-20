import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { renderWithIntl } from "@/test/render";
import { PasswordField } from "./PasswordField";

function Harness() {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="pw">Κωδικός</label>
      <PasswordField id="pw" name="password" autoComplete="current-password" value={value} onChange={setValue} className="f" />
    </>
  );
}

describe("PasswordField", () => {
  it("starts masked, shows the text on the eye, hides it again, and never changes the value", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness />);
    const input = screen.getByLabelText("Κωδικός");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autoComplete", "current-password");

    await user.type(input, "s3cret");
    const eye = screen.getByRole("button", { name: "Εμφάνιση κωδικού" });
    expect(eye).toHaveAttribute("aria-pressed", "false");

    await user.click(eye);
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("s3cret");
    expect(screen.getByRole("button", { name: "Απόκρυψη κωδικού" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Απόκρυψη κωδικού" }));
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveValue("s3cret");
  });
});
