import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { IcraBadge } from "./IcraBadge";

describe("IcraBadge tint mapping", () => {
  it("tints class I and II with the purple background and purple text", () => {
    renderWithIntl(<IcraBadge icraClass="I" size="list" />);
    expect(screen.getByText("I")).toHaveClass("bg-k-purple-bg", "text-k-purple");
    renderWithIntl(<IcraBadge icraClass="II" size="list" />);
    expect(screen.getByText("II")).toHaveClass("bg-k-purple-bg", "text-k-purple");
  });

  it("gives class III a purple outline on white", () => {
    renderWithIntl(<IcraBadge icraClass="III" size="list" />);
    const badge = screen.getByText("III");
    expect(badge).toHaveClass("bg-k-white", "text-k-purple", "border", "border-k-purple");
  });

  it("fills class IV and V with purple and white text", () => {
    renderWithIntl(<IcraBadge icraClass="IV" size="list" />);
    expect(screen.getByText("IV")).toHaveClass("bg-k-purple", "text-k-white");
    renderWithIntl(<IcraBadge icraClass="V" size="list" />);
    expect(screen.getByText("V")).toHaveClass("bg-k-purple", "text-k-white");
  });

  it("switches to a white-on-purple outline when onPurple is set, regardless of class", () => {
    renderWithIntl(<IcraBadge icraClass="IV" size="list" onPurple />);
    expect(screen.getByText("IV")).toHaveClass("text-k-white", "border-k-white");
  });
});

describe("IcraBadge wizard matrix cell", () => {
  it("always renders the matrix excerpt and version alongside the class", () => {
    renderWithIntl(
      <IcraBadge icraClass="IV" size="wizard" activityType="B" riskGroup="3" matrixVersion="v2.1" />,
    );
    expect(screen.getByText("Τύπος εργασίας B × Ομάδα κινδύνου 3 → Κατηγορία IV")).toBeInTheDocument();
    expect(screen.getByText("Έκδοση πίνακα v2.1")).toBeInTheDocument();
  });
});
