import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { HelpProvider, useHelp } from "./HelpProvider";
import { RegisterHelpSection } from "./RegisterHelpSection";

// A tiny consumer standing in for the real HelpButton (@/components/app-shell/HelpButton),
// which does the same `useHelp().open()` call.
function OpenHelpButton() {
  const { open } = useHelp();
  return (
    <button type="button" onClick={open}>
      open help
    </button>
  );
}

describe("HelpProvider", () => {
  it('"?" opens the drawer and Escape closes it', async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <HelpProvider>
        <p>page content</p>
      </HelpProvider>,
    );

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

    await user.keyboard("?");
    expect(screen.getByRole("complementary")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it('"?" typed inside an input does nothing', async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <HelpProvider>
        <input aria-label="a field" />
      </HelpProvider>,
    );

    await user.click(screen.getByLabelText("a field"));
    await user.keyboard("?");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("shows the S01 title when a section is registered", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <HelpProvider>
        <RegisterHelpSection personas={["estates_head"]}>
          <h2>Χαρτοφυλάκιο έργων</h2>
        </RegisterHelpSection>
        <OpenHelpButton />
      </HelpProvider>,
    );

    await user.click(screen.getByRole("button", { name: "open help" }));
    expect(screen.getByRole("heading", { name: "Χαρτοφυλάκιο έργων" })).toBeInTheDocument();
    expect(screen.queryByText("Η βοήθεια για αυτή την οθόνη δεν έχει γραφτεί ακόμη.")).not.toBeInTheDocument();
  });

  it("shows the unwritten sentence when no section is registered", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <HelpProvider>
        <OpenHelpButton />
      </HelpProvider>,
    );

    await user.click(screen.getByRole("button", { name: "open help" }));
    expect(screen.getByText("Η βοήθεια για αυτή την οθόνη δεν έχει γραφτεί ακόμη.")).toBeInTheDocument();
  });
});
