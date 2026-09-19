import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { Approvals } from "./Approvals";

const DECIDABLE = {
  id: "ap1",
  type: "SHUTDOWN" as const,
  whatEl: "Διακοπή ρεύματος",
  whereEl: "Λάρνακα › Χειρουργείο 1",
  requestedByName: "Ν. Νικολάου",
  requestedAt: "2026-03-12T09:00:00.000Z",
  dueAt: "2026-03-14T09:00:00.000Z",
  slaState: "GREEN" as const,
  unread: true,
  facts: [{ label: "a", value: "1" }, { label: "b", value: "2" }, { label: "c", value: "3" }],
  href: "/permits/p1",
  decidable: true,
};

const NOT_DECIDABLE = {
  ...DECIDABLE,
  id: "v1",
  type: "VARIATION" as const,
  href: "/contracts/1/variations",
  decidable: false,
};

describe("Approvals", () => {
  it("opens the DecisionPanel with the three facts for the deep-linked item", () => {
    renderWithIntl(<Approvals items={[DECIDABLE]} state="default" openItemId="ap1" onOpen={vi.fn()} onClose={vi.fn()} onDecide={vi.fn()} noPermission={<div />} />);
    expect(screen.getByRole("dialog", { name: "Διακοπή ρεύματος" })).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("disables the primary decision buttons and shows «Άνοιγμα» for a non-decidable item", () => {
    renderWithIntl(<Approvals items={[NOT_DECIDABLE]} state="default" openItemId="v1" onOpen={vi.fn()} onClose={vi.fn()} onDecide={vi.fn()} noPermission={<div />} />);
    expect(screen.getByRole("button", { name: "Έγκριση" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Άνοιγμα" })).toHaveAttribute("href", "/contracts/1/variations");
  });

  it("fires onDecide with APPROVED on Έγκριση for a decidable item", async () => {
    const onDecide = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    renderWithIntl(<Approvals items={[DECIDABLE]} state="default" openItemId="ap1" onOpen={vi.fn()} onClose={vi.fn()} onDecide={onDecide} noPermission={<div />} />);
    await userEvent.click(screen.getByRole("button", { name: "Έγκριση" }));
    expect(onDecide).toHaveBeenCalledWith(DECIDABLE, "APPROVED");
  });
});
