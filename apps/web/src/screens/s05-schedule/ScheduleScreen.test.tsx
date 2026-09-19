import { describe, expect, it } from "vitest";
import { Milestone } from "@ecapital/shared";
import { buildMilestonePatch, milestonePatchPath } from "./ScheduleScreen";

const baseline = Milestone.parse({
  id: "MS-1",
  projectId: "PRJ-1",
  titleEl: "Υπογραφή σύμβασης",
  baselineDate: "2026-06-01",
  forecastDate: "2026-06-05",
  actualDate: null,
  isGate: true,
  sortOrder: 2,
});

describe("milestonePatchPath", () => {
  it("builds the PATCH path from the project and milestone ids", () => {
    expect(milestonePatchPath("PRJ-1", "MS-1")).toBe("/projects/PRJ-1/milestones/MS-1");
  });
});

describe("buildMilestonePatch", () => {
  // RULE (apps/api projects.service.ts updateMilestone): the endpoint reads
  // titleEl/isGate/baselineDate unconditionally and 422s with
  // errors.baselineFixed the moment baselineDate differs from what is
  // stored — so every PATCH this screen sends must echo them back
  // unchanged and only vary the one edited field.
  it("echoes titleEl, isGate and baselineDate unchanged and only changes the edited field", () => {
    const body = buildMilestonePatch(baseline, "forecast", "2026-06-20");
    expect(body).toEqual({
      titleEl: "Υπογραφή σύμβασης",
      baselineDate: "2026-06-01",
      isGate: true,
      sortOrder: 2,
      forecastDate: "2026-06-20",
      actualDate: null,
    });
  });

  it("turns a cleared field into null, never an empty string", () => {
    const body = buildMilestonePatch(baseline, "forecast", "   ");
    expect(body.forecastDate).toBeNull();
  });

  it("edits actualDate without disturbing forecastDate", () => {
    const body = buildMilestonePatch(baseline, "actual", "2026-06-18");
    expect(body.actualDate).toBe("2026-06-18");
    expect(body.forecastDate).toBe("2026-06-05");
  });
});
