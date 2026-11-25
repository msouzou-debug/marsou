import { describe, expect, it } from "vitest";
import {
  answeredOnBeforeRaised,
  clockAt,
  dueWindowOn,
  evidenceMime,
  sentOnBeforeRaised,
  slaState,
  slaWindow,
} from "./rfi-rows";

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

  it("stops at the end of the day the answer arrived when it was typed in later (owner, UAT 25/11/2026)", () => {
    // Typed in on 14/03 at 02:00 Nicosia; arrived on 10/03, which ends at
    // 22:00 UTC (Nicosia is UTC+2 in March).
    const typedIn = new Date("2026-03-14T00:00:00Z");
    expect(clockAt(typedIn, NOW, { answeredOn: "2026-03-10" }).toISOString()).toBe(
      "2026-03-10T21:59:59.999Z",
    );
    // A day after the typing cannot move the clock past the typing.
    expect(clockAt(typedIn, NOW, { answeredOn: "2026-03-20" })).toBe(typedIn);
  });

  it("stops at the close of an RFI closed without an answer", () => {
    const closedAt = new Date("2026-03-12T00:00:00Z");
    expect(clockAt(null, NOW, { closedAt })).toBe(closedAt);
    expect(clockAt(null, NOW, { closedAt: null })).toBe(NOW);
  });
});

describe("answeredOnBeforeRaised", () => {
  it("refuses the day before the RFI was raised and allows that day and later", () => {
    // 23:30 UTC on 13/03 is 01:30 on 14/03 in Nicosia.
    const raisedAt = new Date("2026-03-13T23:30:00Z");
    expect(answeredOnBeforeRaised(raisedAt, "2026-03-13")).toBe(true);
    expect(answeredOnBeforeRaised(raisedAt, "2026-03-14")).toBe(false);
    expect(answeredOnBeforeRaised(raisedAt, "2026-03-15")).toBe(false);
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

describe("dueWindowOn (UAT 25/11/2026)", () => {
  // 09:00 in Nicosia on 20/11/2026 (UTC+2).
  const raised = new Date("2026-11-20T07:00:00Z");

  it("runs to the end of the chosen day in Nicosia", () => {
    const window = dueWindowOn(raised, "2026-11-27");
    expect(window?.dueAt.toISOString()).toBe("2026-11-27T21:59:59.999Z");
    // 7 days and 15 hours, rounded up to the hour.
    expect(window?.hours).toBe(7 * 24 + 15);
  });

  it("allows the day it was raised, and never a window under an hour", () => {
    expect(dueWindowOn(raised, "2026-11-20")?.hours).toBe(15);
    const lateInTheDay = new Date("2026-11-20T21:59:00Z");
    expect(dueWindowOn(lateInTheDay, "2026-11-20")?.hours).toBe(1);
  });

  it("refuses a due date before the day it was raised", () => {
    expect(dueWindowOn(raised, "2026-11-19")).toBeNull();
  });
});

describe("sentOnBeforeRaised (owner decision 25/11/2026)", () => {
  // 23:30 UTC on 19/11 is already 20/11 in Nicosia (UTC+2 in November).
  const raisedLate = new Date("2026-11-19T23:30:00Z");

  it("allows the Nicosia day it was raised and any later one", () => {
    expect(sentOnBeforeRaised(raisedLate, "2026-11-20")).toBe(false);
    expect(sentOnBeforeRaised(raisedLate, "2026-11-25")).toBe(false);
  });

  it("refuses a day before it, read in Nicosia and not in UTC", () => {
    expect(sentOnBeforeRaised(raisedLate, "2026-11-19")).toBe(true);
  });

  it("has nothing to say about a sent day nobody gave", () => {
    expect(sentOnBeforeRaised(raisedLate, null)).toBe(false);
    expect(sentOnBeforeRaised(raisedLate, undefined)).toBe(false);
  });
});

describe("evidenceMime", () => {
  it("files a .msg and a .eml by their extension, whatever the browser said", () => {
    expect(evidenceMime("RFI 3.msg", "application/octet-stream")).toBe("application/vnd.ms-outlook");
    expect(evidenceMime("RFI 3.MSG", "")).toBe("application/vnd.ms-outlook");
    expect(evidenceMime("reply.eml", "application/octet-stream")).toBe("message/rfc822");
  });

  it("keeps the declared type for anything else, for the whitelist to judge", () => {
    expect(evidenceMime("rfi.pdf", "Application/PDF ")).toBe("application/pdf");
    expect(evidenceMime("plan.dwg", "application/octet-stream")).toBe("application/octet-stream");
  });
});
