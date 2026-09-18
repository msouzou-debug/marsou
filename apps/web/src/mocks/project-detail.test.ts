import { describe, expect, it } from "vitest";
import { projects } from "./projects";
import { buildProjectDetail } from "./project-detail";

describe("buildProjectDetail", () => {
  it("is deterministic for the same project id — no Math.random anywhere", () => {
    const a = buildProjectDetail(projects[3]);
    const b = buildProjectDetail(projects[3]);
    expect(a).toEqual(b);
  });

  it("keeps every fixture inside the documented bounds", () => {
    for (const project of projects) {
      const detail = buildProjectDetail(project);
      expect(detail.milestones.length).toBeGreaterThanOrEqual(2);
      expect(detail.milestones.length).toBeLessThanOrEqual(4);
      expect(detail.milestones.filter((m) => m.isGate)).toHaveLength(1);
      expect(detail.risks.length).toBeLessThanOrEqual(3);
      expect(detail.issues.length).toBeLessThanOrEqual(2);
      expect(detail.audit.length).toBeGreaterThanOrEqual(3);
      expect(detail.audit.length).toBeLessThanOrEqual(6);
    }
  });

  it("opens every project's audit trail with \"created\"", () => {
    for (const project of projects) {
      const detail = buildProjectDetail(project);
      expect(detail.audit[0].action).toBe("created");
    }
  });

  it("produces at least one overdue milestone (forecast in the past, no actual) across the fixtures", () => {
    const today = new Date("2026-09-18T00:00:00.000Z");
    const hasOverdue = projects.some((project) =>
      buildProjectDetail(project).milestones.some(
        (m) => m.actualDate === null && new Date(m.forecastDate ?? "") < today,
      ),
    );
    expect(hasOverdue).toBe(true);
  });
});
