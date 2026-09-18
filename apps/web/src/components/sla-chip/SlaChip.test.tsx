import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { SlaChip, slaState } from "./SlaChip";

const NOW = new Date("2026-03-14T00:00:00Z");

describe("slaState", () => {
  it("is green above 50% of the SLA remaining", () => {
    const dueAt = new Date(NOW.getTime() + 30 * 3_600_000).toISOString(); // 30h left of 48h
    expect(slaState(dueAt, 48, NOW)).toBe("green");
  });

  it("is amber at exactly 50% and down to just above 10%", () => {
    const at50 = new Date(NOW.getTime() + 24 * 3_600_000).toISOString(); // exactly 50% of 48h
    expect(slaState(at50, 48, NOW)).toBe("amber");
    const at11pct = new Date(NOW.getTime() + 5.5 * 3_600_000).toISOString(); // ~11.5% of 48h
    expect(slaState(at11pct, 48, NOW)).toBe("amber");
  });

  it("is red below 10% but still in the future", () => {
    const at5pct = new Date(NOW.getTime() + 2 * 3_600_000).toISOString(); // ~4% of 48h
    expect(slaState(at5pct, 48, NOW)).toBe("red");
  });

  it("is breached once the due date has passed", () => {
    const past = new Date(NOW.getTime() - 1).toISOString();
    expect(slaState(past, 48, NOW)).toBe("breached");
    expect(slaState(NOW.toISOString(), 48, NOW)).toBe("breached"); // due exactly now
  });

  it("treats a non-positive SLA length as breached rather than dividing by zero", () => {
    const future = new Date(NOW.getTime() + 3_600_000).toISOString();
    expect(slaState(future, 0, NOW)).toBe("breached");
  });
});

describe("SlaChip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows days remaining when a day or more is left", () => {
    const dueAt = new Date(NOW.getTime() + 48 * 3_600_000).toISOString();
    renderWithIntl(<SlaChip dueAt={dueAt} totalHours={96} />);
    expect(screen.getByText("Απομένουν 2 ημ")).toBeInTheDocument();
  });

  it("shows hours remaining under a day", () => {
    const dueAt = new Date(NOW.getTime() + 5 * 3_600_000).toISOString();
    renderWithIntl(<SlaChip dueAt={dueAt} totalHours={48} />);
    expect(screen.getByText("Απομένουν 5 ω")).toBeInTheDocument();
  });

  it("shows the breached label in white on red once the due date has passed", () => {
    const dueAt = new Date(NOW.getTime() - 3_600_000).toISOString();
    renderWithIntl(<SlaChip dueAt={dueAt} totalHours={48} />);
    expect(screen.getByText("Εκπρόθεσμο")).toBeInTheDocument();
  });

  it("ticks once a minute via a single interval, and clears it on unmount", () => {
    const setSpy = vi.spyOn(global, "setInterval");
    const clearSpy = vi.spyOn(global, "clearInterval");
    const dueAt = new Date(NOW.getTime() + 48 * 3_600_000).toISOString();
    const { unmount } = renderWithIntl(<SlaChip dueAt={dueAt} totalHours={96} />);

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);

    unmount();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
