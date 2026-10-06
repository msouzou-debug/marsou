import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  dateEl,
  downtimeHours,
  endOfDayNicosia,
  fromNicosiaLocal,
  historyText,
  nicosiaYear,
  pmDeadlines,
  replacementRule,
  riskBandForCriticality,
  todayInNicosia,
  workOrderSla,
  type TimerFacts,
} from "./maintenance-rules";

/**
 * M5's server-side arithmetic (ADR-0031): Nicosia wall-clock time, working
 * days for an extension, the PM deadlines, the timers on a stored order and
 * R36's replacement rule. CAPEX-01 §15 asks for unit tests on SLA state.
 */
describe("Nicosia time", () => {
  it("reads 23:59 on a winter date as 21:59 UTC and on a summer date as 20:59 UTC", () => {
    expect(endOfDayNicosia("2026-01-15")).toBe("2026-01-15T21:59:00.000Z");
    expect(endOfDayNicosia("2026-07-15")).toBe("2026-07-15T20:59:00.000Z");
  });

  it("finds the right instant on the night the clocks go forward (29/03/2026)", () => {
    // 01:30 does not exist on the 29th (03:00 EET → 04:00 EEST), 12:00 does.
    expect(fromNicosiaLocal("2026-03-29", "12:00:00")).toBe("2026-03-29T09:00:00.000Z");
    expect(fromNicosiaLocal("2026-03-28", "12:00:00")).toBe("2026-03-28T10:00:00.000Z");
  });

  it("puts 23:30 UTC on 31 December into the next Nicosia year and day", () => {
    expect(nicosiaYear("2026-12-31T23:30:00Z")).toBe(2027);
    expect(todayInNicosia(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("writes a date the Greek way", () => {
    expect(dateEl("2026-03-02T08:00:00Z")).toBe("02/03/2026");
  });
});

describe("working days (contract note 2)", () => {
  it("skips the weekend: five working days from a Thursday is the next Thursday", () => {
    // 2026-10-01 is a Thursday. 14:00 UTC is 17:00 in Nicosia.
    expect(addWorkingDays("2026-10-01T14:00:00.000Z", 5)).toBe("2026-10-08T14:00:00.000Z");
  });

  it("from a Friday, one working day is the Monday", () => {
    expect(addWorkingDays("2026-10-02T09:00:00.000Z", 1)).toBe("2026-10-05T09:00:00.000Z");
  });

  it("keeps the Nicosia wall-clock time across the night the clocks go back", () => {
    // 23/10/2026 Friday 10:00 EEST (07:00 UTC); +5 working days is Friday
    // 30/10 10:00 EET, which is 08:00 UTC.
    expect(addWorkingDays("2026-10-23T07:00:00.000Z", 5)).toBe("2026-10-30T08:00:00.000Z");
  });

  it("zero days is the deadline itself", () => {
    expect(addWorkingDays("2026-10-01T14:00:00.000Z", 0)).toBe("2026-10-01T14:00:00.000Z");
  });
});

describe("PM deadlines", () => {
  it("the visit by 23:59 on the day, the report by 23:59 a week later", () => {
    expect(pmDeadlines("2026-03-10")).toEqual({
      dueRestoreAt: "2026-03-10T21:59:00.000Z",
      dueReportAt: "2026-03-17T21:59:00.000Z",
    });
  });
});

function order(overrides: Partial<TimerFacts> = {}): TimerFacts {
  return {
    kind: "CORRECTIVE",
    status: "OPEN",
    calledAt: "2026-10-06T08:00:00.000Z",
    dueResponseAt: "2026-10-06T08:30:00.000Z",
    dueRestoreAt: "2026-10-06T10:00:00.000Z",
    dueReportAt: "2026-10-07T08:00:00.000Z",
    respondedAt: null,
    restoredAt: null,
    completedAt: null,
    reportReceivedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

describe("the three timers on an order", () => {
  it("is GREEN inside the time and AMBER in its last quarter", () => {
    expect(workOrderSla(order(), "2026-10-06T08:10:00.000Z").response).toBe("GREEN");
    expect(workOrderSla(order(), "2026-10-06T08:25:00.000Z").response).toBe("AMBER");
  });

  it("is RED overdue and still open, BREACHED when met late, GREEN when met in time", () => {
    const now = "2026-10-06T12:00:00.000Z";
    const late = workOrderSla(order({ respondedAt: "2026-10-06T09:00:00.000Z" }), now);
    expect(late.response).toBe("BREACHED");
    expect(late.restore).toBe("RED");
    const met = workOrderSla(
      order({ respondedAt: "2026-10-06T08:20:00.000Z", restoredAt: "2026-10-06T09:00:00.000Z" }),
      now,
    );
    expect(met).toEqual({ response: "GREEN", restore: "GREEN", report: "GREEN" });
  });

  it("counts a completion without a restore as the restore", () => {
    const sla = workOrderSla(
      order({ completedAt: "2026-10-06T09:59:00.000Z", status: "COMPLETED" }),
      "2026-10-06T12:00:00.000Z",
    );
    expect(sla.restore).toBe("GREEN");
  });

  it("gives a PM order only the restore slot, met by completion", () => {
    const pm = order({
      kind: "PM",
      dueResponseAt: null,
      dueRestoreAt: "2026-10-10T20:59:00.000Z",
      dueReportAt: "2026-10-17T20:59:00.000Z",
    });
    expect(workOrderSla(pm, "2026-10-06T12:00:00.000Z")).toEqual({
      response: null,
      restore: "GREEN",
      report: null,
    });
    expect(workOrderSla(pm, "2026-10-11T00:00:00.000Z").restore).toBe("RED");
  });

  it("gives a cancelled call no clocks at all", () => {
    expect(
      workOrderSla(order({ status: "CANCELLED" }), "2026-10-08T00:00:00.000Z"),
    ).toEqual({ response: null, restore: null, report: null });
  });

  it("measures downtime from the call to the restore, or to now, corrective only", () => {
    expect(downtimeHours(order({ restoredAt: "2026-10-06T09:30:00.000Z" }), "2026-10-07T00:00:00Z")).toBe(1.5);
    expect(downtimeHours(order(), "2026-10-06T11:00:00.000Z")).toBe(3);
    expect(downtimeHours(order({ kind: "PM" }), "2026-10-06T11:00:00.000Z")).toBeNull();
  });
});

describe("R36 — the replacement rule", () => {
  const line = (ref: string, cost: number | null) => ({
    ref,
    calledAt: "2026-05-01T08:00:00.000Z",
    cost,
  });

  it("drafts on three corrective orders, whatever they cost", () => {
    expect(replacementRule([line("A", 0), line("B", 0), line("C", null)], null)).toBe(
      "THREE_CORRECTIVE_IN_12_MONTHS",
    );
  });

  it("drafts when the repairs cost more than half the replacement estimate", () => {
    expect(replacementRule([line("A", 600)], 1000)).toBe("REPAIR_COST_OVER_THRESHOLD");
    expect(replacementRule([line("A", 500)], 1000)).toBeNull();
  });

  it("is silent on an asset nobody priced, below three orders", () => {
    expect(replacementRule([line("A", 99999), line("B", 1)], null)).toBeNull();
  });

  it("writes the history one line per order, oldest first, with the sum", () => {
    const text = historyText([
      { ref: "NGH-WO-2026-0002", calledAt: "2026-06-01T08:00:00Z", cost: 650 },
      { ref: "NGH-WO-2026-0001", calledAt: "2026-05-01T08:00:00Z", cost: 1800 },
    ]);
    expect(text.split("\n")).toEqual([
      "NGH-WO-2026-0001, 01/05/2026, 1.800,00 €",
      "NGH-WO-2026-0002, 01/06/2026, 650,00 €",
      "Σύνολο επισκευών: 2.450,00 €",
    ]);
  });

  it("bands a life-critical asset HIGH and a cosmetic one LOW", () => {
    expect(riskBandForCriticality(1)).toBe("HIGH");
    expect(riskBandForCriticality(2)).toBe("SIGNIFICANT");
    expect(riskBandForCriticality(3)).toBe("MODERATE");
    expect(riskBandForCriticality(5)).toBe("LOW");
  });
});
