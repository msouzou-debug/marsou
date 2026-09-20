import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { CriticalityChip } from "./CriticalityChip";

describe("CriticalityChip", () => {
  it("shows the number and an accessible label", () => {
    renderWithIntl(<CriticalityChip value={1} />);
    expect(screen.getByLabelText("Κρισιμότητα 1")).toHaveTextContent("1");
  });

  // RULE (asset.ts Criticality): 1–2 urgent (red), 3 watch (amber), 4–5 routine (grey).
  it.each([
    [1 as const, "bg-k-red-bg"],
    [2 as const, "bg-k-red-bg"],
    [3 as const, "bg-k-amber-bg"],
    [4 as const, "bg-k-grey"],
    [5 as const, "bg-k-grey"],
  ])("bands value %i with %s, never purple", (value, className) => {
    renderWithIntl(<CriticalityChip value={value} />);
    const chip = screen.getByLabelText(`Κρισιμότητα ${value}`);
    expect(chip.className).toContain(className);
    expect(chip.className).not.toContain("purple");
  });
});
