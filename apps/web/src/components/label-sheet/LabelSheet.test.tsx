import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { LabelSheet, nameSize, tagSize } from "./LabelSheet";

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

  // UAT 25/11/2026: printed labels overflowed. Every label is a fixed box in
  // mm with nothing allowed out of it; long text wraps, clamps or shrinks.
  it("prints each label as a fixed 32 mm box that clips, in 3 columns that never grow", () => {
    const { container } = renderWithIntl(<LabelSheet labels={[label(1), label(2)]} />);
    const page = container.querySelector<HTMLElement>('[data-testid="labels-page"]');
    expect(page?.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(page?.style.gridAutoRows).toBe("32mm");
    const box = container.querySelector<HTMLElement>('[data-testid="asset-label"]');
    expect(box?.style.height).toBe("32mm");
    expect(box).toHaveClass("overflow-hidden");
    // The QR is 20 mm (76 px) and never shrinks to make room for text.
    expect(box?.querySelector("svg")).toHaveAttribute("width", "76");
    expect(box?.querySelector("svg")?.parentElement).toHaveClass("shrink-0");
    // The ΟΚΥπΥ mark stays as it was.
    expect(box?.querySelector("img")).toHaveAttribute("width", "20");
  });

  it("never cuts the tag: it wraps instead, and shrinks a point when long", () => {
    renderWithIntl(<LabelSheet labels={[{ ...label(1), tag: "LCH-MEDGAS-MANIFOLD-0001" }]} />);
    const tag = screen.getByText("LCH-MEDGAS-MANIFOLD-0001");
    expect(tag).toHaveAttribute("data-size", "long");
    expect(tag).toHaveClass("break-all", "text-[9pt]");
    expect(tag).not.toHaveClass("truncate");
    expect(tagSize("NGH-AHU-01")).toBe("short");
  });

  it("wraps a long name to three lines with an ellipsis, two when an area line follows", () => {
    const longName = "Κεντρική κλιματιστική μονάδα επεξεργασίας αέρα χειρουργείων πτέρυγας Β";
    const { unmount } = renderWithIntl(
      <LabelSheet labels={[{ ...label(1), nameEl: longName, areaNameEl: null }]} />,
    );
    const name = screen.getByText(longName);
    expect(name).toHaveClass("line-clamp-3", "text-[8pt]");
    expect(name).toHaveAttribute("data-size", "long");
    expect(name).toHaveAttribute("title", longName);
    unmount();
    renderWithIntl(<LabelSheet labels={[{ ...label(1), nameEl: longName }]} />);
    expect(screen.getByText(longName)).toHaveClass("line-clamp-2");
    expect(nameSize("Κλιματιστικό 1")).toBe("short");
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
