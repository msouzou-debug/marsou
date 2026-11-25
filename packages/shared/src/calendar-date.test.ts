import { describe, expect, it } from "vitest";
import {
  PastOrTodayDate,
  calendarDaysBetween,
  endOfNicosiaDay,
  isCalendarDate,
  isOnlyFutureDateIssue,
  nicosiaDateOf,
  startOfNicosiaDay,
} from "./calendar-date";

describe("calendar dates (owner date-sanity rule, UAT 25/11/2026)", () => {
  it("reads the Nicosia day, not the UTC one", () => {
    // 23:30 UTC on 28/02 is 01:30 on 01/03 in Nicosia (UTC+2 in winter).
    expect(nicosiaDateOf(new Date("2026-02-28T23:30:00Z"))).toBe("2026-03-01");
    expect(nicosiaDateOf(new Date("2026-07-10T20:59:00Z"))).toBe("2026-07-10");
    expect(nicosiaDateOf(new Date("2026-07-10T21:00:00Z"))).toBe("2026-07-11");
  });

  it("knows a real day from a malformed one", () => {
    expect(isCalendarDate("2026-11-25")).toBe(true);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("25/11/2026")).toBe(false);
  });

  it("finds the start and end of a Nicosia day in winter and in summer", () => {
    expect(startOfNicosiaDay("2026-01-15").toISOString()).toBe("2026-01-14T22:00:00.000Z");
    expect(endOfNicosiaDay("2026-01-15").toISOString()).toBe("2026-01-15T21:59:59.999Z");
    expect(startOfNicosiaDay("2026-07-15").toISOString()).toBe("2026-07-14T21:00:00.000Z");
    expect(endOfNicosiaDay("2026-07-15").toISOString()).toBe("2026-07-15T20:59:59.999Z");
  });

  it("counts calendar days either way", () => {
    expect(calendarDaysBetween("2026-11-20", "2026-11-27")).toBe(7);
    expect(calendarDaysBetween("2026-11-27", "2026-11-20")).toBe(-7);
  });

  it("refuses a day after today and accepts today and earlier", () => {
    const today = nicosiaDateOf(new Date());
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    expect(PastOrTodayDate.safeParse(today).success).toBe(true);
    expect(PastOrTodayDate.safeParse("2020-01-01").success).toBe(true);
    const future = PastOrTodayDate.safeParse(tomorrow.toISOString().slice(0, 10));
    expect(future.success).toBe(false);
    expect(future.success ? false : isOnlyFutureDateIssue(future.error)).toBe(true);
    const malformed = PastOrTodayDate.safeParse("2026-02-30");
    expect(malformed.success ? true : isOnlyFutureDateIssue(malformed.error)).toBe(false);
  });
});
