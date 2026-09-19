import { describe, expect, it } from "vitest";
import { countAt, riskScore, scoreBand } from "./risk-matrix";

describe("scoreBand", () => {
  it("bands ≤4 low, 5–12 medium, >12 high", () => {
    expect(scoreBand(1)).toBe("LOW");
    expect(scoreBand(4)).toBe("LOW");
    expect(scoreBand(5)).toBe("MEDIUM");
    expect(scoreBand(12)).toBe("MEDIUM");
    expect(scoreBand(13)).toBe("HIGH");
    expect(scoreBand(25)).toBe("HIGH");
  });
});

describe("riskScore / countAt", () => {
  const risks = [
    { likelihood: 4, impact: 5 },
    { likelihood: 4, impact: 5 },
    { likelihood: 2, impact: 2 },
  ];

  it("multiplies likelihood by impact", () => {
    expect(riskScore({ likelihood: 4, impact: 5 })).toBe(20);
  });

  it("counts risks at exactly one likelihood/impact pair", () => {
    expect(countAt(risks, 4, 5)).toBe(2);
    expect(countAt(risks, 2, 2)).toBe(1);
    expect(countAt(risks, 1, 1)).toBe(0);
  });
});
