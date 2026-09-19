import type { IcraMatrixVersion, PatientRiskGroup } from "@ecapital/shared";
import { describe, expect, it } from "vitest";
import {
  seedIcraCells,
  seedIcraGrid,
  seedIcraMatrixVersion,
  icraControls,
} from "../db/seed-data";
import {
  cellFor,
  evaluate,
  highestRisk,
  missingAcknowledgements,
  surroundingCandidates,
} from "./icra-engine";

/**
 * R20 — the ICRA engine, rule by rule (CAPEX-01 §6.2 and the ASHE ICRA 2.0
 * row of §2). This is clinical safety: every one of these is a sentence from
 * the brief, and the matrix cells are checked one at a time rather than in a
 * loop over the same table the code reads, so a typo in the seed cannot agree
 * with itself.
 */
const matrix: IcraMatrixVersion = {
  id: seedIcraMatrixVersion.id,
  basedOn: seedIcraMatrixVersion.basedOn,
  effectiveFrom: seedIcraMatrixVersion.effectiveFrom,
  approvedByName: null,
  approvedAt: null,
  status: "ACTIVE",
  notesEl: seedIcraMatrixVersion.notesEl,
  cells: seedIcraCells,
};

const area = (id: string, patientRiskGroup: PatientRiskGroup) => ({ id, patientRiskGroup });

describe("the ICRA matrix, cell by cell", () => {
  it("ships all sixteen cells, one per activity type per risk group", () => {
    expect(seedIcraCells).toHaveLength(16);
    const keys = new Set(seedIcraCells.map((cell) => `${cell.activityType}:${cell.riskGroup}`));
    expect(keys.size).toBe(16);
  });

  // The four rows of ASHE ICRA 2.0 Table 3, written out rather than derived.
  it("LOW: A→I, B→II, C→II, D→III", () => {
    expect(cellFor(matrix, "A", "LOW").icraClass).toBe("I");
    expect(cellFor(matrix, "B", "LOW").icraClass).toBe("II");
    expect(cellFor(matrix, "C", "LOW").icraClass).toBe("II");
    expect(cellFor(matrix, "D", "LOW").icraClass).toBe("III");
  });

  it("MEDIUM: A→I, B→II, C→III, D→IV", () => {
    expect(cellFor(matrix, "A", "MEDIUM").icraClass).toBe("I");
    expect(cellFor(matrix, "B", "MEDIUM").icraClass).toBe("II");
    expect(cellFor(matrix, "C", "MEDIUM").icraClass).toBe("III");
    expect(cellFor(matrix, "D", "MEDIUM").icraClass).toBe("IV");
  });

  it("HIGH: A→I, B→II, C→IV, D→IV — CAPEX-01 §2, Type C in a high-risk area is IV, not III", () => {
    expect(cellFor(matrix, "A", "HIGH").icraClass).toBe("I");
    expect(cellFor(matrix, "B", "HIGH").icraClass).toBe("II");
    // The rule the brief calls out by name. Getting this wrong puts a
    // construction crew into a high-risk ward under Class III precautions.
    expect(cellFor(matrix, "C", "HIGH").icraClass).toBe("IV");
    expect(cellFor(matrix, "D", "HIGH").icraClass).toBe("IV");
  });

  it("HIGHEST: A→II, B→III, C→IV, D→V", () => {
    expect(cellFor(matrix, "A", "HIGHEST").icraClass).toBe("II");
    expect(cellFor(matrix, "B", "HIGHEST").icraClass).toBe("III");
    expect(cellFor(matrix, "C", "HIGHEST").icraClass).toBe("IV");
    expect(cellFor(matrix, "D", "HIGHEST").icraClass).toBe("V");
  });

  it("refuses a version with a hole in it rather than answering without a class", () => {
    const holed: IcraMatrixVersion = {
      ...matrix,
      cells: seedIcraCells.filter((cell) => !(cell.activityType === "C" && cell.riskGroup === "HIGH")),
    };
    expect(() => cellFor(holed, "C", "HIGH")).toThrow(/no cell/);
  });

  it("carries bilingual controls on every cell, with stable ids and a phase", () => {
    for (const cell of seedIcraCells) {
      expect(cell.controls.length).toBeGreaterThan(0);
      for (const control of cell.controls) {
        expect(control.id).toMatch(/^[IVX]+-\d\d$/);
        expect(control.textEl.length).toBeGreaterThan(10);
        expect(control.textEn.length).toBeGreaterThan(10);
        expect(["DURING", "ON_COMPLETION"]).toContain(control.phase);
      }
      const ids = cell.controls.map((control) => control.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("makes each class ask for everything the class below it asks for", () => {
    const three = new Set(icraControls("III").map((control) => control.id));
    for (const control of icraControls("II")) expect(three.has(control.id)).toBe(true);
    const five = new Set(icraControls("V").map((control) => control.id));
    for (const control of icraControls("IV")) expect(five.has(control.id)).toBe(true);
  });

  it("marks the seeded edition as still waiting on Infection Control (§6.2)", () => {
    expect(seedIcraMatrixVersion.notesEl).toBe("Προς επικύρωση από την Επιτροπή Ελέγχου Λοιμώξεων");
    expect(seedIcraMatrixVersion.basedOn).toBe("ASHE ICRA 2.0 (2022)");
    expect(seedIcraMatrixVersion.effectiveFrom).toBe("2026-01-01");
  });

  it("keeps the grid and the cells saying the same thing", () => {
    for (const cell of seedIcraCells) {
      expect(cell.icraClass).toBe(seedIcraGrid[cell.riskGroup][cell.activityType]);
    }
  });
});

describe("the risk group is the highest of every area involved (§6.2)", () => {
  it("takes the worst band over the affected areas", () => {
    const winner = highestRisk([area("a", "LOW"), area("b", "HIGH"), area("c", "MEDIUM")]);
    expect(winner.patientRiskGroup).toBe("HIGH");
    expect(winner.id).toBe("b");
  });

  it("names the area that set it, so the screen can say why", () => {
    const result = evaluate({
      activityType: "B",
      workKind: "MAINTENANCE",
      areas: [area("plant", "LOW"), area("theatre", "HIGHEST")],
      surrounding: [],
      matrix,
    });
    expect(result.riskGroup).toBe("HIGHEST");
    expect(result.riskGroupFromAreaId).toBe("theatre");
  });

  it("counts an indirect area exactly like a direct one (§6.1)", () => {
    // The riser is in a plant room; the ICU two floors up is what it feeds.
    const direct = evaluate({
      activityType: "C",
      workKind: "MAINTENANCE",
      areas: [area("plant", "LOW")],
      surrounding: [],
      matrix,
    });
    expect(direct.icraClass).toBe("II");

    const withIndirect = evaluate({
      activityType: "C",
      workKind: "MAINTENANCE",
      areas: [area("plant", "LOW"), area("icu", "HIGHEST")],
      surrounding: [],
      matrix,
    });
    expect(withIndirect.icraClass).toBe("IV");
    expect(withIndirect.riskGroupFromAreaId).toBe("icu");
  });

  it("lets a surrounding area raise the group", () => {
    const result = evaluate({
      activityType: "B",
      workKind: "MAINTENANCE",
      areas: [area("office", "LOW")],
      surrounding: [
        { side: "ABOVE", areaId: "theatre-above", patientRiskGroup: "HIGHEST", noteEl: null },
      ],
      matrix,
    });
    expect(result.riskGroup).toBe("HIGHEST");
    expect(result.riskGroupFromAreaId).toBe("theatre-above");
    expect(result.icraClass).toBe("III");
  });

  it("counts a surrounding band with no area behind it, and names the side", () => {
    const candidates = surroundingCandidates([
      { side: "BELOW", areaId: null, patientRiskGroup: "HIGH", noteEl: "Θάλαμος από κάτω" },
      { side: "BEHIND", areaId: null, patientRiskGroup: null, noteEl: "Εξωτερικός τοίχος" },
    ]);
    expect(candidates).toEqual([{ id: "surrounding:BELOW", patientRiskGroup: "HIGH" }]);
  });
});

describe("what the class means (§6.2)", () => {
  it("needs a printed permit from Class III up, and not below it", () => {
    const below = evaluate({
      activityType: "B",
      workKind: "MAINTENANCE",
      areas: [area("office", "LOW")],
      surrounding: [],
      matrix,
    });
    expect(below.icraClass).toBe("II");
    expect(below.permitRequired).toBe(false);

    const above = evaluate({
      activityType: "D",
      workKind: "MAINTENANCE",
      areas: [area("office", "LOW")],
      surrounding: [],
      matrix,
    });
    expect(above.icraClass).toBe("III");
    expect(above.permitRequired).toBe(true);
  });

  it("refuses Class II for construction and for renovation, and only for those", () => {
    // LOW × B is Class II in the matrix.
    const base = {
      activityType: "B" as const,
      areas: [area("office", "LOW")],
      surrounding: [],
      matrix,
    };
    expect(evaluate({ ...base, workKind: "CONSTRUCTION" }).refusalKey).toBe(
      "classTwoInvalidForWorks",
    );
    expect(evaluate({ ...base, workKind: "RENOVATION" }).refusalKey).toBe(
      "classTwoInvalidForWorks",
    );
    expect(evaluate({ ...base, workKind: "MAINTENANCE" }).refusalKey).toBeNull();
    expect(evaluate({ ...base, workKind: "INSPECTION" }).refusalKey).toBeNull();
    expect(evaluate({ ...base, workKind: "OTHER" }).refusalKey).toBeNull();
  });

  it("does not refuse a construction job that resolves above Class II", () => {
    const result = evaluate({
      activityType: "C",
      workKind: "CONSTRUCTION",
      areas: [area("ward", "HIGH")],
      surrounding: [],
      matrix,
    });
    expect(result.icraClass).toBe("IV");
    expect(result.refusalKey).toBeNull();
  });

  it("records the matrix version every evaluation was decided under", () => {
    const result = evaluate({
      activityType: "A",
      workKind: "INSPECTION",
      areas: [area("office", "LOW")],
      surrounding: [],
      matrix,
    });
    expect(result.matrixVersionId).toBe("OKYPY-ICRA-2.0-2026.1");
  });

  it("hands back the cell's controls, which is what the checklist prints", () => {
    const result = evaluate({
      activityType: "C",
      workKind: "MAINTENANCE",
      areas: [area("theatre", "HIGHEST")],
      surrounding: [],
      matrix,
    });
    expect(result.controls).toEqual(icraControls("IV"));
  });
});

describe("the controls have to be acknowledged (UI §5 S12)", () => {
  it("names the ones nobody ticked", () => {
    const controls = icraControls("II");
    const missing = missingAcknowledgements(controls, [controls[0].id]);
    expect(missing).toHaveLength(controls.length - 1);
    expect(missing).not.toContain(controls[0].id);
  });

  it("is satisfied only when every single one is ticked", () => {
    const controls = icraControls("IV");
    expect(missingAcknowledgements(controls, controls.map((c) => c.id))).toEqual([]);
  });
});
