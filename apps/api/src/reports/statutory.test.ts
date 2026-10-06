import { describe, expect, it } from "vitest";
import { type StatutoryOrder, STATUTORY_ORDER, statutoryCategoryOf, statutoryCounts } from "./statutory";

const facts = (over: Partial<Parameters<typeof statutoryCategoryOf>[0]> = {}) => ({
  assetClasses: [],
  permitSystems: [],
  systemName: null,
  ...over,
});

describe("statutoryCategoryOf (ADR-0032 §4)", () => {
  it("maps a LIFT asset to LIFTS", () => {
    expect(statutoryCategoryOf(facts({ assetClasses: ["LIFT", null] }))).toBe("LIFTS");
  });

  it("maps medical gas by asset class or by permit system", () => {
    expect(statutoryCategoryOf(facts({ assetClasses: ["MEDICAL_GAS"] }))).toBe("MEDICAL_GAS");
    expect(statutoryCategoryOf(facts({ permitSystems: [null, "MEDICAL_GAS"] }))).toBe("MEDICAL_GAS");
  });

  it("maps FIRE by asset class or by permit system", () => {
    expect(statutoryCategoryOf(facts({ assetClasses: [null, "FIRE"] }))).toBe("FIRE_SYSTEMS");
    expect(statutoryCategoryOf(facts({ permitSystems: ["FIRE"] }))).toBe("FIRE_SYSTEMS");
  });

  it("maps pressure vessels by the STEAM system or by «ατμ» / «λέβητ» in the line's name", () => {
    expect(statutoryCategoryOf(facts({ permitSystems: ["STEAM"] }))).toBe("PRESSURE_VESSELS");
    expect(statutoryCategoryOf(facts({ systemName: "Σύστημα Παραγωγής Ατμού 10bar (±1bar)" }))).toBe(
      "PRESSURE_VESSELS",
    );
    expect(statutoryCategoryOf(facts({ systemName: "ΛΕΒΗΤΕΣ ΚΕΝΤΡΙΚΗΣ ΘΕΡΜΑΝΣΗΣ" }))).toBe("PRESSURE_VESSELS");
    expect(statutoryCategoryOf(facts({ systemName: "Λέβητας ζεστού νερού", assetClasses: ["WATER"] }))).toBe(
      "PRESSURE_VESSELS",
    );
  });

  it("does not call an electrical line a pressure vessel because it mentions boiler rooms", () => {
    expect(
      statutoryCategoryOf(
        facts({
          assetClasses: ["ELECTRICAL"],
          permitSystems: ["ELECTRICAL"],
          systemName: "Σύστημα Διανομής Ισχύος … περιλαμβανομένων μηχανοστασίων/ λεβητοστασίων",
        }),
      ),
    ).toBeNull();
  });

  it("reads the explicit classes before the name", () => {
    expect(
      statutoryCategoryOf(facts({ assetClasses: ["MEDICAL_GAS"], systemName: "Παροχή ατμού και ιατρικών αερίων" })),
    ).toBe("MEDICAL_GAS");
    expect(statutoryCategoryOf(facts({ assetClasses: ["LIFT"], permitSystems: ["FIRE"] }))).toBe("LIFTS");
  });

  it("counts nothing that matches no category", () => {
    expect(statutoryCategoryOf(facts({ assetClasses: ["HVAC"], permitSystems: ["HVAC"], systemName: "Σύστημα Κλιματισμού" }))).toBeNull();
    expect(statutoryCategoryOf(facts())).toBeNull();
  });
});

describe("statutoryCounts", () => {
  const NOW = "2026-10-06T10:00:00.000Z";
  const order = (over: Partial<StatutoryOrder>): StatutoryOrder => ({
    orgUnitId: "nicosia-general",
    category: "LIFTS",
    status: "OPEN",
    deadline: "2026-09-30T20:59:00.000Z",
    completedAt: null,
    ...over,
  });

  it("returns all four categories in order, zeros included", () => {
    const counts = statutoryCounts([], NOW);
    expect(counts.map((c) => c.category)).toEqual(STATUTORY_ORDER);
    expect(counts.every((c) => c.due === 0 && c.done === 0 && c.overdue === 0 && c.donePct === null)).toBe(true);
  });

  it("counts done by the deadline, overdue past it, and neither for a late completion", () => {
    const counts = statutoryCounts(
      [
        order({ status: "COMPLETED", completedAt: "2026-09-29T08:00:00.000Z" }), // done
        order({ status: "COMPLETED", completedAt: "2026-10-02T08:00:00.000Z" }), // late: neither
        order({ status: "IN_PROGRESS" }), // overdue
        order({ deadline: "2026-10-31T21:59:00.000Z" }), // not yet due
        order({ status: "CANCELLED" }), // not owed
        order({ category: "FIRE_SYSTEMS", deadline: null, status: "COMPLETED", completedAt: NOW }), // done, no deadline
        order({ category: "FIRE_SYSTEMS", deadline: null }), // never overdue
      ],
      NOW,
    );
    const lifts = counts.find((c) => c.category === "LIFTS");
    expect(lifts).toEqual({ category: "LIFTS", due: 4, done: 1, overdue: 1, donePct: 25 });
    const fire = counts.find((c) => c.category === "FIRE_SYSTEMS");
    expect(fire).toEqual({ category: "FIRE_SYSTEMS", due: 2, done: 1, overdue: 0, donePct: 50 });
  });
});
