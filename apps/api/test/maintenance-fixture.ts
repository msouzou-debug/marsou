import type { ScoreOrder } from "../src/maintenance/scorecard";

/**
 * R37's fixed fixture, shared by the unit test of `computeScorecard` and the
 * integration test that writes the same orders into the database and reads
 * the scorecard back through the API. Every expected figure is worked out by
 * hand in the comments (ADR-0031 §9).
 *
 * March 2026: 31 days; Nicosia is UTC+2 until the 29th.
 * S1 CRITICAL 0.5 h / 2 h / 24 h, rates 10 €/h response, 20 €/h restore,
 * 50 €/day PM. S2 P1 0.5 h / 24 h / 48 h, no rates (the Nicosia case).
 * Agreement: 8600 h/year, 5 €/h critical, 1 €/h other, value 100.000 €.
 */
export const SCORE_FROM = "2026-03-01";
export const SCORE_TO = "2026-04-01";

const S1 = { band: "CRITICAL" as const, code: "1.1.1", rates: [50, 10, 20] as const };
const S2 = { band: "P1" as const, code: "1.2.1", rates: [null, null, null] as const };

function o(
  ref: string,
  kind: ScoreOrder["kind"],
  status: string,
  system: typeof S1 | typeof S2,
  asset: string | null,
  times: Partial<ScoreOrder>,
): ScoreOrder {
  return {
    id: ref,
    ref,
    kind,
    status,
    band: system.band,
    slaSystemCode: system.code,
    slaSystemName: system.code,
    assetId: asset,
    calledAt: "",
    dueResponseAt: null,
    respondedAt: null,
    dueRestoreAt: null,
    restoredAt: null,
    completedAt: null,
    dueReportAt: null,
    reportReceivedAt: null,
    dueDate: null,
    penaltyPmPerDay: system.rates[0],
    penaltyResponsePerHour: system.rates[1],
    penaltyRestorePerHour: system.rates[2],
    ...times,
  };
}

/** The same orders the integration test writes into the database. */
export const SCORE_ORDERS: ScoreOrder[] = [
  // O1: all three on time. Down 1.5 h.
  o("O1", "CORRECTIVE", "COMPLETED", S1, "A", {
    calledAt: "2026-03-02T08:00:00.000Z",
    dueResponseAt: "2026-03-02T08:30:00.000Z",
    respondedAt: "2026-03-02T08:20:00.000Z",
    dueRestoreAt: "2026-03-02T10:00:00.000Z",
    restoredAt: "2026-03-02T09:30:00.000Z",
    dueReportAt: "2026-03-03T08:00:00.000Z",
    reportReceivedAt: "2026-03-02T20:00:00.000Z",
    completedAt: "2026-03-02T20:00:00.000Z",
  }),
  // O2: all three late — response 0.5 h, restore 10 h, report 24 h. Down 12 h.
  o("O2", "CORRECTIVE", "COMPLETED", S1, "A", {
    calledAt: "2026-03-10T10:00:00.000Z",
    dueResponseAt: "2026-03-10T10:30:00.000Z",
    respondedAt: "2026-03-10T11:00:00.000Z",
    dueRestoreAt: "2026-03-10T12:00:00.000Z",
    restoredAt: "2026-03-10T22:00:00.000Z",
    dueReportAt: "2026-03-11T10:00:00.000Z",
    reportReceivedAt: "2026-03-12T10:00:00.000Z",
    completedAt: "2026-03-12T10:00:00.000Z",
  }),
  // O3: on time. Down 1 h. Asset A's third order in the period.
  o("O3", "CORRECTIVE", "COMPLETED", S1, "A", {
    calledAt: "2026-03-20T06:00:00.000Z",
    dueResponseAt: "2026-03-20T06:30:00.000Z",
    respondedAt: "2026-03-20T06:10:00.000Z",
    dueRestoreAt: "2026-03-20T08:00:00.000Z",
    restoredAt: "2026-03-20T07:00:00.000Z",
    dueReportAt: "2026-03-21T06:00:00.000Z",
    reportReceivedAt: "2026-03-20T12:00:00.000Z",
    completedAt: "2026-03-20T12:00:00.000Z",
  }),
  // O4: response 0.25 h late and restore 8 h late on a line with no rates;
  // report on time. Down 32 h.
  o("O4", "CORRECTIVE", "COMPLETED", S2, "B", {
    calledAt: "2026-03-05T12:00:00.000Z",
    dueResponseAt: "2026-03-05T12:30:00.000Z",
    respondedAt: "2026-03-05T12:45:00.000Z",
    dueRestoreAt: "2026-03-06T12:00:00.000Z",
    restoredAt: "2026-03-06T20:00:00.000Z",
    dueReportAt: "2026-03-07T12:00:00.000Z",
    reportReceivedAt: "2026-03-07T10:00:00.000Z",
    completedAt: "2026-03-07T10:00:00.000Z",
  }),
  // O5: statutory, all on time; no downtime (not corrective).
  o("O5", "STATUTORY", "COMPLETED", S2, null, {
    calledAt: "2026-03-15T09:00:00.000Z",
    dueResponseAt: "2026-03-15T09:30:00.000Z",
    respondedAt: "2026-03-15T09:20:00.000Z",
    dueRestoreAt: "2026-03-16T09:00:00.000Z",
    restoredAt: "2026-03-15T15:00:00.000Z",
    dueReportAt: "2026-03-17T09:00:00.000Z",
    reportReceivedAt: "2026-03-16T09:00:00.000Z",
    completedAt: "2026-03-16T09:00:00.000Z",
  }),
  // O6: withdrawn — counts nowhere, however late it would have been.
  o("O6", "CORRECTIVE", "CANCELLED", S1, "A", {
    calledAt: "2026-03-18T08:00:00.000Z",
    dueResponseAt: "2026-03-18T08:30:00.000Z",
    dueRestoreAt: "2026-03-18T10:00:00.000Z",
    dueReportAt: "2026-03-19T08:00:00.000Z",
  }),
  // O7: called in February — outside the period.
  o("O7", "CORRECTIVE", "COMPLETED", S1, "A", {
    calledAt: "2026-02-25T08:00:00.000Z",
    dueResponseAt: "2026-02-25T08:30:00.000Z",
    respondedAt: "2026-02-25T10:00:00.000Z",
    dueRestoreAt: "2026-02-25T10:00:00.000Z",
    restoredAt: "2026-02-26T10:00:00.000Z",
    dueReportAt: "2026-02-26T08:00:00.000Z",
    completedAt: "2026-02-26T10:00:00.000Z",
  }),
  // P1: programme date 10/03 (issued in February), done on time.
  o("P1", "PM", "COMPLETED", S1, "A", {
    calledAt: "2026-02-24T05:00:00.000Z",
    dueDate: "2026-03-10",
    dueRestoreAt: "2026-03-10T21:59:00.000Z",
    dueReportAt: "2026-03-17T21:59:00.000Z",
    completedAt: "2026-03-10T15:00:00.000Z",
  }),
  // P2: programme date 25/03, done 27/03 10:00 — 1 d 12 h late, two started days.
  o("P2", "PM", "COMPLETED", S1, "A", {
    calledAt: "2026-03-11T05:00:00.000Z",
    dueDate: "2026-03-25",
    dueRestoreAt: "2026-03-25T21:59:00.000Z",
    dueReportAt: "2026-04-01T20:59:00.000Z",
    completedAt: "2026-03-27T10:00:00.000Z",
  }),
  // P3: issued in March for 5 April — a March order, not a March visit.
  o("P3", "PM", "OPEN", S2, "B", {
    calledAt: "2026-03-22T05:00:00.000Z",
    dueDate: "2026-04-05",
    dueRestoreAt: "2026-04-05T20:59:00.000Z",
    dueReportAt: "2026-04-12T20:59:00.000Z",
  }),
];

export const SCORE_CONTRACT = {
  availabilityHoursYear: 8600,
  availabilityPenaltyCriticalPerHour: 5,
  availabilityPenaltyOtherPerHour: 1,
  contractValue: 100000,
};

/** Worked out by hand from the fixture above. */
export const SCORE_EXPECTED = {
  workOrders: { total: 7, corrective: 4, pm: 2, statutory: 1, open: 1 },
  response: { due: 5, onTime: 3, pct: 60 },
  restore: { due: 5, onTime: 3, pct: 60 },
  report: { due: 5, onTime: 4, pct: 80 },
  pm: { due: 2, onTime: 1, pct: 50 },
  availability: {
    // 1.5 + 12 + 1 and 32; allowance (8760 − 8600) × 31 / 365 = 13.589…
    criticalDowntimeHours: 14.5,
    otherDowntimeHours: 32,
    allowanceHours: 13.59,
    // (14.5 − 13.589) × 5 + (32 − 13.589) × 1 = 4.5548 + 18.4110
    penaltyEur: 22.97,
  },
  penalties: {
    pmEur: 100, // P2: 2 days × 50
    responseEur: 5, // O2: 0.5 h × 10; O4 has no rate
    restoreEur: 200, // O2: 10 h × 20; O4 has no rate
    availabilityEur: 22.97,
    totalEur: 327.97,
    capUsedPct: 0.33,
    ratesMissing: true,
  },
  repeatFailures: 1,
  byBand: [
    { band: "CRITICAL", corrective: 3, responseOnTimePct: 66.7, restoreOnTimePct: 66.7, downtimeHours: 14.5 },
    { band: "P1", corrective: 1, responseOnTimePct: 50, restoreOnTimePct: 50, downtimeHours: 32 },
    { band: "P2", corrective: 0, responseOnTimePct: null, restoreOnTimePct: null, downtimeHours: 0 },
  ],
};
