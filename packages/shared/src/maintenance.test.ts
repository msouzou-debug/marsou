import { describe, expect, it } from "vitest";
import {
  WORK_ORDER_TRANSITIONS,
  WORK_ORDER_ACTION_TARGET,
  addHours,
  nextDueAfter,
  slaStateOf,
} from "./maintenance";

describe("slaStateOf", () => {
  const due = "2026-10-06T10:00:00.000Z";
  it("is null without a deadline", () => {
    expect(slaStateOf(null, null, due, 2)).toBeNull();
  });
  it("is GREEN early, AMBER in the last quarter, RED after", () => {
    expect(slaStateOf(due, null, "2026-10-06T08:00:00.000Z", 2)).toBe("GREEN");
    expect(slaStateOf(due, null, "2026-10-06T09:40:00.000Z", 2)).toBe("AMBER");
    expect(slaStateOf(due, null, "2026-10-06T10:00:01.000Z", 2)).toBe("RED");
  });
  it("stops at the met time: GREEN on time, BREACHED late", () => {
    expect(slaStateOf(due, "2026-10-06T10:00:00.000Z", "2026-11-01T00:00:00.000Z", 2)).toBe("GREEN");
    expect(slaStateOf(due, "2026-10-06T10:30:00.000Z", "2026-11-01T00:00:00.000Z", 2)).toBe("BREACHED");
  });
});

describe("dates", () => {
  it("adds hours including the half hour the contract uses", () => {
    expect(addHours("2026-10-06T10:00:00.000Z", 0.5)).toBe("2026-10-06T10:30:00.000Z");
  });
  it("moves a programme date on by its frequency", () => {
    expect(nextDueAfter("2026-01-31", "MONTHLY")).toBe("2026-03-03");
    expect(nextDueAfter("2026-01-15", "QUARTERLY")).toBe("2026-04-15");
    expect(nextDueAfter("2026-01-15", "SEMIANNUAL")).toBe("2026-07-15");
    expect(nextDueAfter("2026-02-28", "ANNUAL")).toBe("2027-02-28");
    expect(nextDueAfter("2026-10-06", "WEEKLY")).toBe("2026-10-13");
    expect(nextDueAfter("2026-10-06", "DAILY")).toBe("2026-10-07");
  });
});

describe("transitions", () => {
  it("every allowed action lands on a status that allows the next step", () => {
    for (const actions of Object.values(WORK_ORDER_TRANSITIONS)) {
      for (const action of actions) expect(WORK_ORDER_ACTION_TARGET[action]).toBeDefined();
    }
    expect(WORK_ORDER_TRANSITIONS.COMPLETED).toEqual([]);
    expect(WORK_ORDER_TRANSITIONS.PAUSED).toEqual(["RESUME"]);
  });
});
