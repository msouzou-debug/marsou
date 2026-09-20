import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { LabelSheet } from "./LabelSheet";

function label(i: number) {
  return {
    assetId: `a${i}`,
    tag: `NGH-HVAC-${String(i).padStart(4, "0")}`,
    nameEl: `Κλιματιστικό ${i}`,
    areaNameEl: "Θάλαμος 2",
    url: `https://ecapital.test/a/NGH-HVAC-${i}`,
  };
}

describe("LabelSheet", () => {
  it("shows one label per row and its tag in mono", () => {
    renderWithIntl(<LabelSheet labels={[label(1)]} />);
    expect(screen.getByText("NGH-HVAC-0001")).toBeInTheDocument();
    expect(screen.getByText("Κλιματιστικό 1")).toBeInTheDocument();
  });

  // RULE (brief item 4): 3×8 per A4 page — a caller with more labels than
  // fit one page gets a second `.labels-page`, not an overflowing single grid.
  it("splits labels into pages of `perPage`, one page for exactly that many", () => {
    const labels = Array.from({ length: 24 }, (_, i) => label(i + 1));
    const { container } = renderWithIntl(<LabelSheet labels={labels} perPage={24} />);
    expect(container.querySelectorAll('[data-testid="labels-page"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="asset-label"]')).toHaveLength(24);
  });

  it("starts a second page once labels exceed `perPage`", () => {
    const labels = Array.from({ length: 30 }, (_, i) => label(i + 1));
    const { container } = renderWithIntl(<LabelSheet labels={labels} perPage={24} />);
    const pages = container.querySelectorAll('[data-testid="labels-page"]');
    expect(pages).toHaveLength(2);
    expect(pages[0].querySelectorAll('[data-testid="asset-label"]')).toHaveLength(24);
    expect(pages[1].querySelectorAll('[data-testid="asset-label"]')).toHaveLength(6);
  });

  it("renders a single 160px QR with no page chrome in the 'single' variant", () => {
    const { container } = renderWithIntl(<LabelSheet labels={[label(1)]} variant="single" />);
    expect(container.querySelectorAll('[data-testid="labels-page"]')).toHaveLength(0);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "160");
  });

  it("shows the empty sentence with no labels", () => {
    renderWithIntl(<LabelSheet labels={[]} />);
    expect(screen.getByText("Δεν έχουν επιλεγεί πάγια για εκτύπωση ετικέτας.")).toBeInTheDocument();
  });

  it("offers a retry in the error state", () => {
    const onRetry = vi.fn();
    renderWithIntl(<LabelSheet state="error" onRetry={onRetry} />);
    screen.getByRole("button", { name: "Δοκιμάστε ξανά" }).click();
    expect(onRetry).toHaveBeenCalled();
  });
});
