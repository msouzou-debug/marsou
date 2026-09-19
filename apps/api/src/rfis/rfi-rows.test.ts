import { describe, expect, it } from "vitest";
import { clockAt, slaState, slaWindow } from "./rfi-rows";

/**
 * R09 — the SLA band, tested as what it is: arithmetic on two timestamps. No
 * database, no request, and the clock is an argument, so the test says the
 * same thing at every hour of every day.
 *
 * The reference implementation is the chip the user actually reads,
 * `apps/web/src/components/sla-chip/SlaChip.tsx` `slaState()`, and the
 * boundary cases below are deliberately the same ones its own test pins:
 * above half, exactly half, just above a tenth, below a tenth, and past due.
 * If the two ever disagree, a list that says AMBER will be drawing a red
 * chip, which is worse than either answer on its own.
 */
const NOW = new Date("2026-03-14T00:00:00Z");
const HOUR = 3_600_000;

/** A due date this many hours from NOW. */
function due(hours: number): string {
  return new Date(NOW.getTime() + hours * HOUR).toISOString();
}

describe("slaState", () => {
  it("is GREEN above half the SLA remaining", () => {
    // 30h of 48h = 62.5%.
    expect(slaState(due(30), 48, NOW)).toBe("GREEN");
    // 51% of a seven-day promise, the boundary from the other side.
    expect(slaState(due(168 * 0.51), 168, NOW)).toBe("GREEN");
  });

  it("is AMBER at exactly half, and down to just above a tenth", () => {
    // RULE: the boundary belongs to the worse band. A clock that still says
    // GREEN at the halfway mark is a clock nobody chases.
    expect(slaState(due(24), 48, NOW)).toBe("AMBER");
    expect(slaState(due(168 * 0.5), 168, NOW)).toBe("AMBER");
    expect(slaState(due(5.5), 48, NOW)).toBe("AMBER");
  });

  it("is RED at exactly a tenth and below, while the moment is still to come", () => {
    expect(slaState(due(4.8), 48, NOW)).toBe("RED");
    expect(slaState(due(168 * 0.1), 168, NOW)).toBe("RED");
    expect(slaState(due(168 * 0.09), 168, NOW)).toBe("RED");
    expect(slaState(due(0.001), 48, NOW)).toBe("RED");
  });

  it("is BREACHED once the due moment has arrived", () => {
    expect(slaState(new Date(NOW.getTime() - 1).toISOString(), 48, NOW)).toBe("BREACHED");
    // Due exactly now counts as breached, the same as the chip.
    expect(slaState(NOW.toISOString(), 48, NOW)).toBe("BREACHED");
  });

  it("treats an SLA of no length as breached rather than dividing by zero", () => {
    expect(slaState(due(1), 0, NOW)).toBe("BREACHED");
    expect(slaState(due(1), -5, NOW)).toBe("BREACHED");
  });

  it("takes a Date as readily as a string, because that is what pg hands back", () => {
    expect(slaState(new Date(NOW.getTime() + 30 * HOUR), 48, NOW)).toBe("GREEN");
  });
});

describe("clockAt", () => {
  // RULE (ADR-0017): the SLA is a promise about the answer. Once the answer
  // exists the clock stops, so an RFI answered inside its window keeps the
  // band it was answered in instead of drifting to BREACHED in the drawer.
  it("stops at the answer where there is one, and runs to now where there is not", () => {
    const answered = new Date("2026-03-13T00:00:00Z");
    expect(clockAt(answered, NOW)).toBe(answered);
    expect(clockAt(null, NOW)).toBe(NOW);
    expect(slaState(due(1), 48, clockAt(answered, NOW))).toBe("GREEN");
    expect(slaState(due(1), 48, clockAt(null, NOW))).toBe("RED");
  });
});

describe("slaWindow", () => {
  it("is raisedAt + slaDays × 24h, and slaDays × 24 hours long", () => {
    const { dueAt, hours } = slaWindow(NOW, 7);
    expect(hours).toBe(168);
    expect(dueAt.toISOString()).toBe("2026-03-21T00:00:00.000Z");
    // A freshly raised RFI is as green as an RFI ever gets.
    expect(slaState(dueAt, hours, NOW)).toBe("GREEN");
  });

  it("carries the default of seven days across a month boundary", () => {
    const { dueAt } = slaWindow(new Date("2026-02-25T09:30:00Z"), 7);
    expect(dueAt.toISOString()).toBe("2026-03-04T09:30:00.000Z");
  });
});
