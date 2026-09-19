import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { VariationSheet } from "./VariationSheet";
import { buildVariation } from "./fixture";

describe("VariationSheet — SUBMITTED, decision panel", () => {
  // RULE (R10, ADR-0015): the decider is never the raiser. When they are the
  // same person the buttons are disabled up front, not only after a 403.
  it("disables Έγκριση/Επιστροφή for the raiser and shows the sameUserApproval sentence", () => {
    const variation = buildVariation({ raisedByName: "Μαρία Κωνσταντίνου" });
    renderWithIntl(
      <VariationSheet
        open
        variation={variation}
        contractNo="ΤΥ/2026/031"
        contractCurrentValue={2_400_000}
        meUserId="user-engineer"
        canDecide
        canEdit
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSubmit={vi.fn()}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Έγκριση" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Επιστροφή με σχόλια" })).toBeDisabled();
    expect(
      screen.getByText(
        "Δεν εγκρίνετε τροποποίηση που καταγράψατε εσείς. Αναθέστε την απόφαση σε άλλο πρόσωπο με δικαίωμα έγκρισης.",
      ),
    ).toBeInTheDocument();
    // RULE: the raiser gets no «Απόρριψη» link either — the same rule refuses
    // every decision, not only Approve (`contracts.service.ts`'s `caller ===
    // existing.raisedBy` check runs before the decision is even looked at).
    expect(screen.queryByText("Απόρριψη")).not.toBeInTheDocument();
  });

  // RULE (R10): the same disabled view even for a role that could never
  // decide anything at all — the rule is shown to the raiser, not only to a
  // decider who happens to also be the raiser.
  it("shows the same disabled panel to a project_engineer viewing their own submitted variation", () => {
    const variation = buildVariation({ raisedByName: "Ελένη Χριστοδούλου" });
    renderWithIntl(
      <VariationSheet
        open
        variation={variation}
        contractNo="ΤΥ/2026/031"
        contractCurrentValue={2_400_000}
        meUserId="user-engineer"
        canDecide={false}
        canEdit
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSubmit={vi.fn()}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Έγκριση" })).toBeDisabled();
    expect(
      screen.getByText(
        "Δεν εγκρίνετε τροποποίηση που καταγράψατε εσείς. Αναθέστε την απόφαση σε άλλο πρόσωπο με δικαίωμα έγκρισης.",
      ),
    ).toBeInTheDocument();
  });

  it("enables the decision buttons for someone other than the raiser, with exactly three facts", () => {
    const variation = buildVariation({ raisedByName: "Ελένη Χριστοδούλου", value: 48_000, reason: "CLIENT_CHANGE" });
    renderWithIntl(
      <VariationSheet
        open
        variation={variation}
        contractNo="ΤΥ/2026/031"
        contractCurrentValue={2_400_000}
        meUserId="user-other"
        canDecide
        canEdit={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSubmit={vi.fn()}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Έγκριση" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Επιστροφή με σχόλια" })).toBeEnabled();

    // RULE (UI instructions §4): the panel shows exactly three facts.
    const dialog = screen.getByRole("dialog");
    const dl = dialog.querySelector("dl");
    expect(dl?.querySelectorAll("dt")).toHaveLength(3);
    expect(screen.getByText("€ 48.000")).toBeInTheDocument();
    expect(screen.getByText("Αλλαγή από τον φορέα")).toBeInTheDocument();
    expect(screen.getByText("€ 2.448.000")).toBeInTheDocument();

    expect(screen.getByText("Απόρριψη")).toBeInTheDocument();
  });
});

describe("VariationSheet — SUBMITTED, no decision to make", () => {
  it("shows the plain awaiting view for someone else's submitted variation when the caller cannot decide", () => {
    const variation = buildVariation({ raisedByName: "Άλλος Μηχανικός" });
    renderWithIntl(
      <VariationSheet
        open
        variation={variation}
        contractNo="ΤΥ/2026/031"
        contractCurrentValue={2_400_000}
        meUserId="user-other"
        canDecide={false}
        canEdit
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSubmit={vi.fn()}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByText("Εκκρεμεί απόφαση από υπεύθυνο έγκρισης.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Έγκριση" })).not.toBeInTheDocument();
  });
});

describe("VariationSheet — REJECTED", () => {
  it("is read-only and shows the decision comment, with no edit controls", () => {
    const variation = buildVariation({
      status: "REJECTED",
      decidedById: "user-admin",
      decidedByName: "Μαρία Κωνσταντίνου",
      decidedAt: "2026-05-05T10:00:00.000Z",
      decisionCommentEl: "Ο εξοπλισμός καλύπτεται από χωριστή σύμβαση.",
    });
    renderWithIntl(
      <VariationSheet
        open
        variation={variation}
        contractNo="ΤΥ/2026/031"
        contractCurrentValue={2_400_000}
        meUserId="user-other"
        canDecide={false}
        canEdit
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSubmit={vi.fn()}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByText("Ο εξοπλισμός καλύπτεται από χωριστή σύμβαση.")).toBeInTheDocument();
    expect(screen.getByText(/Η απόρριψη είναι οριστική/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Αποθήκευση" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Υποβολή" })).not.toBeInTheDocument();
  });
});

describe("VariationSheet — DRAFT/RETURNED", () => {
  it("shows the edit form with Αποθήκευση and Υποβολή for the raiser", () => {
    const variation = buildVariation({ status: "DRAFT", raisedByName: "Ελένη Χριστοδούλου" });
    renderWithIntl(
      <VariationSheet
        open
        variation={variation}
        contractNo="ΤΥ/2026/031"
        contractCurrentValue={2_400_000}
        meUserId="user-engineer"
        canDecide={false}
        canEdit
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSubmit={vi.fn()}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Αποθήκευση" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Υποβολή" })).toBeInTheDocument();
  });

  it("shows the returned decision comment above the RETURNED edit form", () => {
    const variation = buildVariation({
      status: "RETURNED",
      raisedByName: "Ελένη Χριστοδούλου",
      decisionCommentEl: "Στείλτε αναλυτική προμέτρηση.",
    });
    renderWithIntl(
      <VariationSheet
        open
        variation={variation}
        contractNo="ΤΥ/2026/031"
        contractCurrentValue={2_400_000}
        meUserId="user-engineer"
        canDecide={false}
        canEdit
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSubmit={vi.fn()}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByText("Στείλτε αναλυτική προμέτρηση.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Αποθήκευση" })).toBeInTheDocument();
  });
});
