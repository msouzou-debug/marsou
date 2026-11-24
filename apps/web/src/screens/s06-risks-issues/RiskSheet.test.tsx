import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { RiskSheet } from "./RiskSheet";

const people = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Ανδρέας Παπαδόπουλος" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Μαρία Κωνσταντίνου" },
];

describe("RiskSheet owner (owner report, 24/11/2026)", () => {
  it("offers the project's people as a list, with no owner as the first choice", () => {
    renderWithIntl(<RiskSheet open people={people} onClose={vi.fn()} onSave={vi.fn()} />);
    const owner = screen.getByLabelText("Υπεύθυνος");
    expect(owner.tagName).toBe("SELECT");
    const options = within(owner).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["— Χωρίς υπεύθυνο —", "Ανδρέας Παπαδόπουλος", "Μαρία Κωνσταντίνου"]);
  });

  it("keeps a current owner who is no longer on the list, so saving does not clear them", () => {
    renderWithIntl(
      <RiskSheet
        open
        people={people}
        risk={{
          id: "r1",
          projectId: "p1",
          descriptionEl: "Κίνδυνος",
          likelihood: 2,
          impact: 2,
          ownerId: "33333333-3333-4333-8333-333333333333",
          ownerName: "Γιώργος Ιωάννου",
          mitigationEl: null,
          status: "OPEN",
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const owner = screen.getByLabelText("Υπεύθυνος") as HTMLSelectElement;
    expect(owner.value).toBe("33333333-3333-4333-8333-333333333333");
    expect(within(owner).getByRole("option", { name: "Γιώργος Ιωάννου" })).toBeInTheDocument();
  });
});
