import { describe, expect, it } from "vitest";
import { DISRUPTION_STATUSES, disruptionRows, monthSlices } from "./calendar-rows";

/** CAPEX-01 §11 — theatre and ICU hours lost, by unit and month (R25). */

const permit = (over: Partial<Parameters<typeof disruptionRows>[0][number]> = {}) => ({
  permitId: "p1",
  orgUnitId: "nicosia-general",
  orgUnitNameEl: "Γενικό Νοσοκομείο Λευκωσίας",
  start: new Date("2026-03-09T08:00:00Z"),
  end: new Date("2026-03-09T18:00:00Z"),
  touchesTheatre: true,
  touchesIcu: false,
  ...over,
});

describe("hours lost, by unit and month", () => {
  it("counts a ten-hour theatre closure as ten theatre hours", () => {
    const rows = disruptionRows([permit()], 2026);
    expect(rows).toEqual([
      {
        orgUnitId: "nicosia-general",
        orgUnitNameEl: "Γενικό Νοσοκομείο Λευκωσίας",
        month: "2026-03",
        theatreHours: 10,
        icuHours: 0,
        permits: 1,
      },
    ]);
  });

  it("counts a permit touching both a theatre and an ICU in both columns", () => {
    const rows = disruptionRows([permit({ touchesIcu: true })], 2026);
    expect(rows[0].theatreHours).toBe(10);
    expect(rows[0].icuHours).toBe(10);
    expect(rows[0].permits).toBe(1);
  });

  it("splits a window that crosses a month boundary", () => {
    const rows = disruptionRows(
      [
        permit({
          start: new Date("2026-03-31T20:00:00Z"),
          end: new Date("2026-04-01T08:00:00Z"),
        }),
      ],
      2026,
    );
    expect(rows.map((row) => [row.month, row.theatreHours])).toEqual([
      ["2026-03", 4],
      ["2026-04", 8],
    ]);
  });

  it("leaves out the months of another year", () => {
    const rows = disruptionRows(
      [
        permit({
          start: new Date("2025-12-31T20:00:00Z"),
          end: new Date("2026-01-01T08:00:00Z"),
        }),
      ],
      2026,
    );
    expect(rows.map((row) => [row.month, row.theatreHours])).toEqual([["2026-01", 8]]);
  });

  it("adds up several permits in the same unit and month", () => {
    const rows = disruptionRows(
      [permit(), permit({ permitId: "p2", start: new Date("2026-03-20T08:00:00Z"), end: new Date("2026-03-20T12:00:00Z") })],
      2026,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].theatreHours).toBe(14);
    expect(rows[0].permits).toBe(2);
  });

  it("keeps the units apart and orders them by name", () => {
    const rows = disruptionRows(
      [
        permit(),
        permit({
          permitId: "p2",
          orgUnitId: "larnaca-general",
          orgUnitNameEl: "Γενικό Νοσοκομείο Λάρνακας",
          touchesIcu: true,
          touchesTheatre: false,
        }),
      ],
      2026,
    );
    expect(rows.map((row) => row.orgUnitId)).toEqual(["larnaca-general", "nicosia-general"]);
    expect(rows[0].icuHours).toBe(10);
    expect(rows[0].theatreHours).toBe(0);
  });

  it("counts only what was agreed to or actually ran", () => {
    expect(DISRUPTION_STATUSES).toEqual(["APPROVED", "ACTIVE", "BREACH", "CLOSED"]);
  });

  it("returns nothing for a window of no length", () => {
    const at = new Date("2026-03-09T08:00:00Z");
    expect(monthSlices(at, at)).toEqual([]);
    expect(disruptionRows([permit({ start: at, end: at })], 2026)).toEqual([]);
  });

  it("cuts a long window at every month it crosses", () => {
    const slices = monthSlices(new Date("2026-01-15T00:00:00Z"), new Date("2026-03-02T00:00:00Z"));
    expect(slices.map((slice) => [slice.month, slice.hours])).toEqual([
      [0, 17 * 24],
      [1, 28 * 24],
      [2, 1 * 24],
    ]);
  });
});
