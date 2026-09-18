import { describe, expect, it } from "vitest";
import { Project, ProjectLedgers, ProjectSummary } from "./project";

const validProject = {
  id: "PRJ-001",
  code: "NGH-001",
  orgUnitId: "nicosia-general",
  titleEl: "Ανακαίνιση χειρουργείων",
  category: "RENOVATION",
  phase: "IN_PROGRESS",
  approvedBudget: 1_000_000,
  fundingSource: "STATE_BUDGET",
  plannedStart: "2026-01-01",
  plannedFinish: "2026-12-31",
  rag: "GREEN",
  ragReason: "Το έργο βρίσκεται εντός εγκεκριμένου προϋπολογισμού και χρονοδιαγράμματος",
  sapWbs: null,
  tenderReference: null,
};

describe("Project", () => {
  it("accepts a well-formed project", () => {
    expect(() => Project.parse(validProject)).not.toThrow();
  });

  it("has the nine target phases (CAPEX-01 §4 reconciled with CAPEX-03 §4)", () => {
    expect(Project.shape.phase.options).toEqual([
      "IDEA",
      "PREPARATION",
      "APPROVED",
      "TENDERED",
      "AWARDED",
      "IN_PROGRESS",
      "PRACTICAL_COMPLETION",
      "DEFECTS_LIABILITY",
      "CLOSED",
    ]);
  });

  it("rejects an unknown rag value", () => {
    expect(() => Project.parse({ ...validProject, rag: "BLUE" })).toThrow();
  });
});

describe("ProjectSummary", () => {
  it("is a Project plus the four ledgers", () => {
    const ledgers: ProjectLedgers = { approved: 1_000_000, committed: 900_000, spent: 400_000, forecast: 950_000 };
    expect(() => ProjectSummary.parse({ ...validProject, ledgers })).not.toThrow();
  });
});
