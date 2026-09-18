import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { AssetBreadcrumb, type AssetBreadcrumbSegment } from "./AssetBreadcrumb";

const segments: AssetBreadcrumbSegment[] = [
  { value: "Νοσοκομείο Λευκωσίας", href: "/units/nicosia" },
  { value: "Κτίριο Α", href: "/units/nicosia/buildings/a" },
  { value: "2ος όροφος", href: "/units/nicosia/buildings/a/floors/2" },
  { value: "Θάλαμος 214", href: "/units/nicosia/buildings/a/floors/2/rooms/214" },
  { value: "Κλιματιστικό οροφής", href: "/assets/hvac-214" },
];

describe("AssetBreadcrumb", () => {
  it("RULE: the first segment's level label is «Μονάδα», never «Νοσοκομείο»", () => {
    renderWithIntl(<AssetBreadcrumb segments={segments} />);
    const firstLink = screen.getByRole("link", { name: /^Μονάδα:/ });
    expect(firstLink).toHaveAccessibleName("Μονάδα: Νοσοκομείο Λευκωσίας");
    expect(firstLink).not.toHaveAccessibleName(/Νοσοκομείο:/);
  });

  it("uses aria-label from common.unit on the nav", () => {
    renderWithIntl(<AssetBreadcrumb segments={segments} />);
    expect(screen.getByRole("navigation")).toHaveAccessibleName("Μονάδα");
  });

  it("renders a chevron separator between segments, never a text glyph", () => {
    const { container } = renderWithIntl(<AssetBreadcrumb segments={segments} />);
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("/");
    expect(container.textContent).not.toContain(">");
  });

  it("shows every segment's value as visible link text", () => {
    renderWithIntl(<AssetBreadcrumb segments={segments} />);
    for (const s of segments) {
      expect(screen.getByRole("link", { name: new RegExp(`: ${s.value}$`) })).toBeInTheDocument();
    }
  });
});
