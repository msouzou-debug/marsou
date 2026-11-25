import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DATE_IN_FUTURE, dateIssues, nicosiaDayOf, notAfterToday, notBefore, refineDates } from "./calendar-date";
import { CONTRACT_CLAIM_DATE_RULES, CONTRACT_DATE_RULES } from "./contract";

// The two date rules (`calendar-date.ts`, «the date rules»). The Nicosia day
// itself is `nicosiaDateOf`'s, tested in calendar-date.test.ts.

it("names the «happened» rule as the site log does", () => {
  expect(DATE_IN_FUTURE).toBe("dateInFuture");
});

describe("nicosiaDayOf", () => {
  it("reads a plain date, a zoned instant and a datetime-local value", () => {
    expect(nicosiaDayOf("2026-11-25")).toBe("2026-11-25");
    expect(nicosiaDayOf("2026-11-25T22:30:00.000Z")).toBe("2026-11-26");
    expect(nicosiaDayOf("2026-11-25T23:59")).toBe("2026-11-25");
  });

  it("does not guess at anything else", () => {
    expect(nicosiaDayOf("25/11/2026")).toBeNull();
    expect(nicosiaDayOf("")).toBeNull();
  });
});

describe("notAfterToday", () => {
  const today = "2026-11-25";

  it("lets today and the past through", () => {
    expect(notAfterToday("2026-11-25", today)).toBe(true);
    expect(notAfterToday("2019-01-01", today)).toBe(true);
  });

  it("refuses tomorrow", () => {
    expect(notAfterToday("2026-11-26", today)).toBe(false);
    expect(notAfterToday("2026-11-26T00:05", today)).toBe(false);
  });

  it("judges an instant by its day in Nicosia", () => {
    // 22:30 UTC on the 25th is already the 26th in Nicosia.
    expect(notAfterToday("2026-11-25T22:30:00Z", today)).toBe(false);
    expect(notAfterToday("2026-11-25T21:30:00Z", today)).toBe(true);
  });

  it("has nothing to say about a missing date", () => {
    expect(notAfterToday(null, today)).toBe(true);
    expect(notAfterToday(undefined, today)).toBe(true);
    expect(notAfterToday("", today)).toBe(true);
  });
});

describe("notBefore", () => {
  it("lets an end on or after its start through", () => {
    expect(notBefore("2026-12-31", "2026-01-01")).toBe(true);
    expect(notBefore("2026-01-01", "2026-01-01")).toBe(true);
  });

  it("refuses an end before its start", () => {
    expect(notBefore("2025-12-31", "2026-01-01")).toBe(false);
  });

  it("compares two instants as instants and two local times as the clock", () => {
    expect(notBefore("2026-11-25T08:00:00Z", "2026-11-25T09:00:00Z")).toBe(false);
    expect(notBefore("2026-11-25T10:00", "2026-11-25T09:30")).toBe(true);
  });

  it("compares a date against an instant by the day in Nicosia", () => {
    expect(notBefore("2026-11-25", "2026-11-25T21:00:00Z")).toBe(true);
    expect(notBefore("2026-11-25", "2026-11-25T22:30:00Z")).toBe(false);
  });

  it("has nothing to say when either side is missing", () => {
    expect(notBefore(null, "2026-01-01")).toBe(true);
    expect(notBefore("2026-01-01", null)).toBe(true);
  });
});

describe("dateIssues", () => {
  const today = "2026-11-25";

  it("names the field and the rule, the end of a pair being the one at fault", () => {
    expect(
      dateIssues(
        { awardDate: "2026-12-01", startDate: "2027-01-10", completionDate: "2027-01-01" },
        CONTRACT_DATE_RULES,
        today,
      ),
    ).toEqual([
      { field: "awardDate", rule: "dateInFuture" },
      { field: "completionDate", rule: "dateOrder" },
    ]);
  });

  it("finds nothing wrong with a clean record or with fields not sent", () => {
    expect(dateIssues({ awardDate: "2026-11-25" }, CONTRACT_DATE_RULES, today)).toEqual([]);
    expect(dateIssues({}, CONTRACT_DATE_RULES, today)).toEqual([]);
  });

  it("refuses a claim notified tomorrow, or before the contract was awarded", () => {
    expect(dateIssues({ notifiedAt: "2026-11-26" }, CONTRACT_CLAIM_DATE_RULES, today)).toEqual([
      { field: "notifiedAt", rule: "dateInFuture" },
    ]);
    expect(
      dateIssues({ awardDate: "2026-03-01", notifiedAt: "2026-02-01" }, CONTRACT_CLAIM_DATE_RULES, today),
    ).toEqual([{ field: "notifiedAt", rule: "dateOrder" }]);
  });
});

describe("refineDates", () => {
  const schema = z
    .object({ notifiedAt: z.string() })
    .superRefine(refineDates(CONTRACT_CLAIM_DATE_RULES, {}, () => "2026-11-25"));

  it("puts an i18n key under the field", () => {
    const result = schema.safeParse({ notifiedAt: "2026-11-26" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["notifiedAt"], message: "forms.dateInFuture" });
  });

  it("takes a different key where the default sentence would be wrong", () => {
    const ordered = z
      .object({ awardDate: z.string(), notifiedAt: z.string() })
      .superRefine(refineDates(CONTRACT_CLAIM_DATE_RULES, { dateOrder: "forms.dateBeforeAward" }, () => "2026-11-25"));
    const result = ordered.safeParse({ awardDate: "2026-03-01", notifiedAt: "2026-02-01" });
    expect(result.error?.issues[0]).toMatchObject({ path: ["notifiedAt"], message: "forms.dateBeforeAward" });
  });

  it("passes a clean value", () => {
    expect(schema.safeParse({ notifiedAt: "2026-11-25" }).success).toBe(true);
  });
});
