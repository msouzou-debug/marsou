import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { TierChip } from "./TierChip";

// The chip-mapping rules: which tier renders which label, in each language
// (owner decision 20/09/2026 — docs/briefs/README.md Errata "Screen tiers").
describe("TierChip", () => {
  it('maps "day-one" to «Ημέρα 1» in Greek', () => {
    renderWithIntl(<TierChip tier="day-one" />, { locale: "el" });
    expect(screen.getByText("Ημέρα 1")).toBeInTheDocument();
  });

  it('maps "optional" to «Προαιρετικό» in Greek', () => {
    renderWithIntl(<TierChip tier="optional" />, { locale: "el" });
    expect(screen.getByText("Προαιρετικό")).toBeInTheDocument();
  });

  it('maps "day-one" to "Day 1" in English', () => {
    renderWithIntl(<TierChip tier="day-one" />, { locale: "en" });
    expect(screen.getByText("Day 1")).toBeInTheDocument();
  });

  it('maps "optional" to "Optional" in English', () => {
    renderWithIntl(<TierChip tier="optional" />, { locale: "en" });
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });

  it("never shows the same label for both tiers", () => {
    const { unmount } = renderWithIntl(<TierChip tier="day-one" />, { locale: "el" });
    const dayOneText = screen.getByText("Ημέρα 1").textContent;
    unmount();
    renderWithIntl(<TierChip tier="optional" />, { locale: "el" });
    const optionalText = screen.getByText("Προαιρετικό").textContent;
    expect(dayOneText).not.toEqual(optionalText);
  });
});
