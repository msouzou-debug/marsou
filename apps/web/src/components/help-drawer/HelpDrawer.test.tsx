import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { HelpDrawer } from "./HelpDrawer";

describe("HelpDrawer", () => {
  it("empty state: shows the unwritten message and a link to the help centre when no section is given", () => {
    renderWithIntl(
      <HelpDrawer open onClose={() => {}} role="Μηχανικός έργου" pdfHref="/help/pdf" helpCentreHref="/help">
      </HelpDrawer>,
    );
    expect(screen.getByText("Η βοήθεια για αυτή την οθόνη δεν έχει γραφτεί ακόμη.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Άνοιγμα οδηγού χρήσης" })).toHaveAttribute("href", "/help");
  });

  it("default state: renders the given section instead of the empty state", () => {
    renderWithIntl(
      <HelpDrawer open onClose={() => {}} role="Μηχανικός έργου" pdfHref="/help/pdf" helpCentreHref="/help">
        <p>Αυτή η οθόνη δείχνει το χαρτοφυλάκιο έργων.</p>
      </HelpDrawer>,
    );
    expect(screen.getByText("Αυτή η οθόνη δείχνει το χαρτοφυλάκιο έργων.")).toBeInTheDocument();
    expect(screen.queryByText("Η βοήθεια για αυτή την οθόνη δεν έχει γραφτεί ακόμη.")).not.toBeInTheDocument();
  });

  it("shows the persona-scoped PDF guide link in the footer", () => {
    renderWithIntl(
      <HelpDrawer open onClose={() => {}} role="Μηχανικός έργου" pdfHref="/help/pdf" helpCentreHref="/help">
        <p>section</p>
      </HelpDrawer>,
    );
    expect(screen.getByRole("link", { name: "Οδηγός PDF για Μηχανικός έργου" })).toHaveAttribute("href", "/help/pdf");
  });

  it("closes on Escape and on the close button", async () => {
    const onClose = vi.fn();
    renderWithIntl(
      <HelpDrawer open onClose={onClose} role="Μηχανικός έργου" pdfHref="/help/pdf" helpCentreHref="/help">
        <p>section</p>
      </HelpDrawer>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Κλείσιμο" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when closed", () => {
    renderWithIntl(
      <HelpDrawer open={false} onClose={() => {}} role="Μηχανικός έργου" pdfHref="/help/pdf" helpCentreHref="/help" />,
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
