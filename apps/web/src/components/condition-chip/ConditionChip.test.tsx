import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { ConditionChip } from "./ConditionChip";

describe("ConditionChip", () => {
  it("shows the letter and an accessible label", () => {
    renderWithIntl(<ConditionChip value="A" />);
    expect(screen.getByLabelText("Φυσική κατάσταση A — άριστη")).toHaveTextContent("A");
  });

  // RULE (contract asset.ts Condition): null is not assessed yet, never a chip.
  it("renders a dash sentence, never a chip, when the condition is null", () => {
    renderWithIntl(<ConditionChip value={null} />);
    expect(screen.getByText("Δεν έχει αξιολογηθεί")).toBeInTheDocument();
  });

  // RULE: the placeholder is a sentence — body font and `--k-text`, never
  // the `num` mono/tabular style reserved for numbers and codes.
  it("renders the placeholder in the body font, not the mono/num style", () => {
    renderWithIntl(<ConditionChip value={null} />);
    const el = screen.getByText("Δεν έχει αξιολογηθεί");
    expect(el.className).not.toContain("num");
    expect(el.className).toContain("text-k-text");
  });

  it.each([
    ["A" as const, "bg-k-green-bg"],
    ["B" as const, "bg-k-green-bg"],
    ["C" as const, "bg-k-amber-bg"],
    ["D" as const, "bg-k-red-bg"],
    ["E" as const, "bg-k-red-bg"],
  ])("bands %s with %s", (value, className) => {
    renderWithIntl(<ConditionChip value={value} />);
    expect(screen.getByText(value).className).toContain(className);
  });
});
