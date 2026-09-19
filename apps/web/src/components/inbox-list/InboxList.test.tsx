import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { InboxList } from "./InboxList";

const ITEMS = [
  {
    id: "v1",
    type: "VARIATION" as const,
    whatEl: "Τροποποίηση Νο 3",
    whereEl: "Λευκωσία › Πτέρυγα Α",
    requestedByName: "Γ. Παύλου",
    requestedAt: "2026-03-10T09:00:00.000Z",
    dueAt: null,
    slaState: null,
    unread: false,
    facts: [{ label: "a", value: "1" }, { label: "b", value: "2" }, { label: "c", value: "3" }],
    href: "/contracts/1/variations",
    decidable: true,
  },
  {
    id: "s1",
    type: "SHUTDOWN" as const,
    whatEl: "Διακοπή ρεύματος",
    whereEl: "Λάρνακα › Χειρουργείο 1",
    requestedByName: "Ν. Νικολάου",
    requestedAt: "2026-03-12T09:00:00.000Z",
    dueAt: "2026-03-14T09:00:00.000Z",
    slaState: "AMBER" as const,
    unread: true,
    facts: [{ label: "a", value: "1" }, { label: "b", value: "2" }, { label: "c", value: "3" }],
    href: "/permits/1",
    decidable: true,
  },
];

describe("InboxList", () => {
  it("groups Διακοπές before Τροποποιήσεις regardless of input order", () => {
    renderWithIntl(<InboxList items={ITEMS} focusedId={null} onFocus={vi.fn()} onOpen={vi.fn()} />);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings.indexOf("Διακοπές")).toBeLessThan(headings.indexOf("Τροποποιήσεις"));
  });

  it("renders an unread row bold", () => {
    renderWithIntl(<InboxList items={ITEMS} focusedId={null} onFocus={vi.fn()} onOpen={vi.fn()} />);
    const unreadText = screen.getByText("Διακοπή ρεύματος");
    expect(unreadText.className).toMatch(/font-bold/);
    const readText = screen.getByText("Τροποποίηση Νο 3");
    expect(readText.className).not.toMatch(/font-bold/);
  });

  it("opens the item on click", async () => {
    const onOpen = vi.fn();
    renderWithIntl(<InboxList items={ITEMS} focusedId={null} onFocus={vi.fn()} onOpen={onOpen} />);
    screen.getByText("Διακοπή ρεύματος").closest("button")!.click();
    expect(onOpen).toHaveBeenCalledWith("s1");
  });

  it("shows the empty sentence with no items", () => {
    renderWithIntl(<InboxList items={[]} focusedId={null} onFocus={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText(/Δεν υπάρχουν/)).toBeInTheDocument();
  });
});
