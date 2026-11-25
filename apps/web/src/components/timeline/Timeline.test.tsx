import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { Timeline, type TimelineEntry } from "./Timeline";

const entries: TimelineEntry[] = [
  { id: "1", actor: "Μ. Ιωάννου", action: "ενέκρινε το αίτημα", timestamp: "2026-03-10T09:00:00Z" },
  { id: "2", actor: "Γ. Νικολάου", action: "υπέβαλε το αίτημα", timestamp: "2026-03-14T10:42:00Z" },
];

describe("Timeline", () => {
  it("renders newest entry first regardless of input order", () => {
    renderWithIntl(<Timeline entries={entries} defaultOpen />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Γ. Νικολάου");
    expect(items[1]).toHaveTextContent("Μ. Ιωάννου");
  });

  // UAT 25/11/2026: the history starts collapsed behind one button.
  it("starts collapsed with «Εμφάνιση ιστορικού (N)» and opens and closes on click", async () => {
    renderWithIntl(<Timeline entries={entries} />);
    const toggle = screen.getByRole("button", { name: "Εμφάνιση ιστορικού (2)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Γ. Νικολάου")).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Απόκρυψη ιστορικού");
    expect(screen.getByText("Γ. Νικολάου")).toBeInTheDocument();
    const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(list).not.toBeNull();
    expect(list).toBeVisible();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Γ. Νικολάου")).not.toBeInTheDocument();
  });

  it("opens from the keyboard", async () => {
    renderWithIntl(<Timeline entries={entries} />);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Εμφάνιση ιστορικού (2)" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("Μ. Ιωάννου")).toBeInTheDocument();
    await userEvent.keyboard(" ");
    expect(screen.queryByText("Μ. Ιωάννου")).not.toBeInTheDocument();
  });

  it("says it in English too", () => {
    renderWithIntl(<Timeline entries={entries} />, { locale: "en" });
    expect(screen.getByRole("button", { name: "Show history (2)" })).toBeInTheDocument();
  });

  it("shows the fixed empty message when there are no entries, and no button", () => {
    renderWithIntl(<Timeline entries={[]} />);
    expect(screen.getByText("Δεν υπάρχουν καταχωρίσεις ακόμη.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows skeleton rows while loading and no entry text", () => {
    renderWithIntl(<Timeline entries={entries} loading defaultOpen />);
    expect(screen.queryByText("Γ. Νικολάου")).not.toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");
  });

  it("shows a busy, disabled toggle while loading collapsed", () => {
    renderWithIntl(<Timeline entries={entries} loading />);
    const toggle = screen.getByRole("button");
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Γ. Νικολάου")).not.toBeInTheDocument();
  });
});
