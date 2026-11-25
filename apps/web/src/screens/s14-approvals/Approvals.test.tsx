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
  note: null as string | null,
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

  // OWNER UAT 25/11/2026: «Έγκριση και Επιστροφή με σχόλια δεν λειτουργούν».

  it("shows the API's refusal in the panel instead of failing silently", () => {
    renderWithIntl(
      <Approvals
        items={[DECIDABLE]}
        state="default"
        openItemId="ap1"
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onDecide={vi.fn()}
        noPermission={<div />}
        decideError="Ο ρόλος σας δεν σας επιτρέπει να αποφασίσετε αυτή τη γραμμή έγκρισης."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Ο ρόλος σας δεν σας επιτρέπει");
  });

  it("requires a comment for «Επιστροφή με σχόλια» and sends it with RETURNED", async () => {
    const onDecide = vi.fn();
    const { default: userEvent } = await import("@testing-library/user-event");
    renderWithIntl(<Approvals items={[DECIDABLE]} state="default" openItemId="ap1" onOpen={vi.fn()} onClose={vi.fn()} onDecide={onDecide} noPermission={<div />} />);
    const returnButton = screen.getByRole("button", { name: "Επιστροφή με σχόλια" });
    await userEvent.click(returnButton);
    expect(returnButton).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "Λείπει το σχέδιο εκτάκτου ανάγκης.");
    await userEvent.click(returnButton);
    expect(onDecide).toHaveBeenCalledWith(DECIDABLE, "RETURNED", "Λείπει το σχέδιο εκτάκτου ανάγκης.");
  });

  it("says why a returned request waits on its requester, with a link to it", () => {
    const returned = {
      ...DECIDABLE,
      id: "ret1",
      decidable: false,
      note: "Ο/Η Α. Παπαδόπουλος επέστρεψε την αίτηση με σχόλια. Ανοίξτε την, διορθώστε την και υποβάλετέ την ξανά.",
    };
    renderWithIntl(<Approvals items={[returned]} state="default" openItemId="ret1" onOpen={vi.fn()} onClose={vi.fn()} onDecide={vi.fn()} noPermission={<div />} />);
    expect(screen.getByRole("alert")).toHaveTextContent("επέστρεψε την αίτηση με σχόλια");
    expect(screen.getByRole("button", { name: "Έγκριση" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Άνοιγμα" })).toHaveAttribute("href", "/permits/p1");
  });

  it("keeps both buttons inert while a decision is on its way", () => {
    renderWithIntl(<Approvals items={[DECIDABLE]} state="default" openItemId="ap1" onOpen={vi.fn()} onClose={vi.fn()} onDecide={vi.fn()} noPermission={<div />} deciding />);
    expect(screen.getByRole("button", { name: "Έγκριση" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Επιστροφή με σχόλια" })).toBeDisabled();
  });
});
