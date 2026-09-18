import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { Timeline, type TimelineEntry } from "./Timeline";

const entries: TimelineEntry[] = [
  { id: "1", actor: "Μ. Ιωάννου", action: "ενέκρινε το αίτημα", timestamp: "2026-03-10T09:00:00Z" },
  { id: "2", actor: "Γ. Νικολάου", action: "υπέβαλε το αίτημα", timestamp: "2026-03-14T10:42:00Z" },
];

describe("Timeline", () => {
  it("renders newest entry first regardless of input order", () => {
    renderWithIntl(<Timeline entries={entries} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Γ. Νικολάου");
    expect(items[1]).toHaveTextContent("Μ. Ιωάννου");
  });

  it("shows the fixed empty message when there are no entries", () => {
    renderWithIntl(<Timeline entries={[]} />);
    expect(screen.getByText("Δεν υπάρχουν καταχωρήσεις ακόμη.")).toBeInTheDocument();
  });

  it("shows skeleton rows while loading and no entry text", () => {
    renderWithIntl(<Timeline entries={entries} loading />);
    expect(screen.queryByText("Γ. Νικολάου")).not.toBeInTheDocument();
  });
});
