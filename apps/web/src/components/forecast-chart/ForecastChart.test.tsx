import { describe, expect, it } from "vitest";
import { renderWithIntl } from "@/test/render";
import { ForecastChart } from "./ForecastChart";

describe("ForecastChart", () => {
  it("draws one bar per year, tallest at the year with the highest estimate", () => {
    const rows = [
      { year: 2026, value: 100_000 },
      { year: 2027, value: 400_000 },
      { year: 2028, value: 200_000 },
    ];
    const { container } = renderWithIntl(<ForecastChart rows={rows} />);
    const bars = container.querySelectorAll("rect");
    expect(bars).toHaveLength(3);
    const heights = Array.from(bars).map((bar) => Number(bar.getAttribute("height")));
    expect(heights[1]).toBeGreaterThan(heights[0]);
    expect(heights[1]).toBeGreaterThan(heights[2]);
  });

  it("uses --k-blue-deep for every bar, never a second colour or a pie", () => {
    const { container } = renderWithIntl(<ForecastChart rows={[{ year: 2026, value: 1 }]} />);
    expect(container.querySelector("circle")).not.toBeInTheDocument();
    for (const bar of container.querySelectorAll("rect")) {
      expect(bar.getAttribute("fill")).toBe("var(--k-blue-deep)");
    }
  });

  it("shows the empty sentence with no rows", () => {
    const { getByText } = renderWithIntl(<ForecastChart rows={[]} />);
    expect(getByText("Δεν υπάρχουν στοιχεία πρόβλεψης για αυτό το διάστημα.")).toBeInTheDocument();
  });

  it("shows the error sentence", () => {
    const { getByText } = renderWithIntl(<ForecastChart rows={[]} state="error" />);
    expect(getByText("Η πρόβλεψη δεν φορτώθηκε. Δοκιμάστε ξανά.")).toBeInTheDocument();
  });
});
