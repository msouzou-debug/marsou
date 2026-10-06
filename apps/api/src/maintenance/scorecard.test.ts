import { describe, expect, it } from "vitest";
import {
  SCORE_CONTRACT,
  SCORE_EXPECTED,
  SCORE_FROM,
  SCORE_ORDERS,
  SCORE_TO,
} from "../../test/maintenance-fixture";
import { computeScorecard, lateDays, lateHours } from "./scorecard";

/**
 * R37 on the fixed fixture in test/maintenance-fixture.ts, every figure
 * worked out by hand there (ADR-0031 §9).
 */
describe("computeScorecard", () => {
  it("gives the hand-worked figures for the March fixture", () => {
    const card = computeScorecard({
      contract: { id: "c", ref: "Α.Ο 1/26", contractorName: "Ανάδοχος", ...SCORE_CONTRACT },
      from: SCORE_FROM,
      to: SCORE_TO,
      now: "2026-04-10T00:00:00.000Z",
      orders: SCORE_ORDERS,
    });
    expect(card).toMatchObject(SCORE_EXPECTED);
    expect(card.from).toBe(SCORE_FROM);
    expect(card.to).toBe(SCORE_TO);
  });

  it("prices only what is late, and says when a rate it needed is missing", () => {
    const onlyOnTime = SCORE_ORDERS.filter((o) => ["O1", "O3", "O5"].includes(o.ref));
    const card = computeScorecard({
      contract: { id: "c", ref: "r", contractorName: "n", ...SCORE_CONTRACT, contractValue: null },
      from: SCORE_FROM,
      to: SCORE_TO,
      now: "2026-04-10T00:00:00.000Z",
      orders: onlyOnTime,
    });
    expect(card.penalties.ratesMissing).toBe(false);
    expect(card.penalties.responseEur).toBe(0);
    expect(card.penalties.capUsedPct).toBeNull();
    expect(card.pm).toEqual({ due: 0, onTime: 0, pct: null });
  });

  it("counts an open timer as late up to now", () => {
    expect(lateHours("2026-03-01T10:00:00Z", null, "2026-03-01T13:00:00Z")).toBe(3);
    expect(lateHours("2026-03-01T10:00:00Z", "2026-03-01T09:00:00Z", "2026-03-02T00:00:00Z")).toBe(0);
    expect(lateDays("2026-03-25T21:59:00Z", "2026-03-27T10:00:00Z", "2026-04-01T00:00:00Z")).toBe(2);
    expect(lateDays("2026-03-25T21:59:00Z", "2026-03-25T22:00:00Z", "2026-04-01T00:00:00Z")).toBe(1);
  });
});
