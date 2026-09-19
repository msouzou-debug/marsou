import { describe, expect, it } from "vitest";
import { durationMinutes, EMPTY_WIZARD_DRAFT, step1Complete, step2Complete, step3Complete } from "./schema";

describe("step1Complete", () => {
  it("requires a unit, at least one system and a title of 3+ characters", () => {
    expect(step1Complete(EMPTY_WIZARD_DRAFT)).toBe(false);
    expect(step1Complete({ ...EMPTY_WIZARD_DRAFT, orgUnitId: "u1", systems: ["ELECTRICAL"], titleEl: "Δι" })).toBe(false);
    expect(step1Complete({ ...EMPTY_WIZARD_DRAFT, orgUnitId: "u1", systems: ["ELECTRICAL"], titleEl: "Διακοπή" })).toBe(true);
  });
});

describe("step2Complete", () => {
  it("requires at least one directly picked area", () => {
    expect(step2Complete(EMPTY_WIZARD_DRAFT)).toBe(false);
    expect(step2Complete({ ...EMPTY_WIZARD_DRAFT, areaIds: ["a1"] })).toBe(true);
  });
});

describe("step3Complete / durationMinutes", () => {
  const start = "2026-03-14T08:00";
  const end = "2026-03-14T16:00";
  it("requires the end after the start", () => {
    expect(step3Complete({ ...EMPTY_WIZARD_DRAFT, plannedStart: start, plannedEnd: end })).toBe(true);
    expect(step3Complete({ ...EMPTY_WIZARD_DRAFT, plannedStart: end, plannedEnd: start })).toBe(false);
  });
  it("computes the duration in minutes once both ends are set", () => {
    expect(durationMinutes({ ...EMPTY_WIZARD_DRAFT, plannedStart: start, plannedEnd: end })).toBe(480);
    expect(durationMinutes(EMPTY_WIZARD_DRAFT)).toBeNull();
  });
});
