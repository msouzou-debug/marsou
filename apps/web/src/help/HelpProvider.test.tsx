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

  // R50: the footer PDF link is the signed-in user's own persona guide, for
  // the current locale — not a guide for whatever screen's section happens
  // to be registered (the two can be different personas, e.g. an estates
  // head reading a technician's screen).
  describe("footer PDF guide link (R50)", () => {
    it("points at /guides/<role>.<locale>.pdf for the signed-in user's role, in Greek", async () => {
      const user = userEvent.setup();
      renderWithIntl(
        <HelpProvider userRole="project_engineer">
          <RegisterHelpSection personas={["finance"]}>
            <h2>Κόστος</h2>
          </RegisterHelpSection>
          <OpenHelpButton />
        </HelpProvider>,
        { locale: "el" },
      );

      await user.click(screen.getByRole("button", { name: "open help" }));
      const link = screen.getByRole("link", { name: /Οδηγός PDF/ });
      expect(link).toHaveAttribute("href", "/guides/project_engineer.el.pdf");
      expect(link).toHaveAttribute("target", "_blank");
    });

    it("uses the current locale, in English", async () => {
      const user = userEvent.setup();
      renderWithIntl(
        <HelpProvider userRole="finance">
          <OpenHelpButton />
        </HelpProvider>,
        { locale: "en" },
      );

      await user.click(screen.getByRole("button", { name: "open help" }));
      expect(screen.getByRole("link", { name: /PDF guide/ })).toHaveAttribute("href", "/guides/finance.en.pdf");
    });

    it("falls back to the help centre when there is no signed-in role", async () => {
      const user = userEvent.setup();
      renderWithIntl(
        <HelpProvider>
          <OpenHelpButton />
        </HelpProvider>,
      );

      await user.click(screen.getByRole("button", { name: "open help" }));
      expect(screen.getByRole("link", { name: /Οδηγός PDF/ })).toHaveAttribute("href", "/help");
    });
  });
});
