import { describe, expect, it } from "vitest";
import { buildHistory, priorityRank, wholeLifeOf } from "./asset-rows";

/**
 * The three pieces of M4 that are arithmetic rather than SQL. Each of them is
 * a rule somebody will argue with a year from now, so each is written down
 * here as well as in ADR-0028.
 */
describe("priorityRank", () => {
  it("puts the life-critical, life-expired asset first", () => {
    expect(priorityRank(1, "E", "IN_SERVICE")).toBe(1);
  });

  it("ranks by criticality before condition", () => {
    // A criticality-1 asset in as-new condition still outranks every
    // criticality-2 asset, however bad that one's condition is.
    expect(priorityRank(1, "A", "IN_SERVICE")).toBeLessThan(
      priorityRank(2, "E", "IN_SERVICE") as number,
    );
  });

  it("is the same number wherever the same asset is listed", () => {
    // S21 sorts on it and so does the register; a rank that depended on the
    // page would make the two disagree.
    expect(priorityRank(3, "C", "IN_SERVICE")).toBe(priorityRank(3, "C", "OUT_OF_SERVICE"));
  });

  it("puts an unknown condition behind the five known bands of its criticality", () => {
    expect(priorityRank(2, null, "IN_SERVICE")).toBeGreaterThan(
      priorityRank(2, "A", "IN_SERVICE") as number,
    );
    expect(priorityRank(2, null, "IN_SERVICE")).toBeLessThan(
      priorityRank(3, "E", "IN_SERVICE") as number,
    );
  });

  it("gives a disposed asset no rank at all", () => {
    expect(priorityRank(1, "E", "DISPOSED")).toBeNull();
  });
});

describe("wholeLifeOf", () => {
  const now = new Date("2026-09-20T00:00:00Z");

  it("takes the age from the commissioning date when there is one", () => {
    const life = wholeLifeOf(
      {
        capitalCost: 84000,
        replacementCostEst: 120000,
        replacementYear: 2031,
        expectedLifeYears: 15,
        installedDate: "2015-01-01",
        commissionedDate: "2016-09-20",
      },
      now,
    );
    expect(life.ageYears).toBe(10);
    expect(life.remainingLifeYears).toBe(5);
  });

  it("falls back to the installation date", () => {
    const life = wholeLifeOf(
      {
        capitalCost: null,
        replacementCostEst: null,
        replacementYear: null,
        expectedLifeYears: 20,
        installedDate: "2021-09-20",
        commissionedDate: null,
      },
      now,
    );
    expect(life.ageYears).toBe(5);
    expect(life.remainingLifeYears).toBe(15);
  });

  it("never reports a negative remaining life", () => {
    const life = wholeLifeOf(
      {
        capitalCost: 10,
        replacementCostEst: null,
        replacementYear: null,
        expectedLifeYears: 5,
        installedDate: "2000-01-01",
        commissionedDate: null,
      },
      now,
    );
    // Twenty-six years old with a five-year life: none left, not minus
    // twenty-one.
    expect(life.remainingLifeYears).toBe(0);
  });

  it("says nothing rather than guessing when the dates or the life are missing", () => {
    const life = wholeLifeOf(
      {
        capitalCost: 1,
        replacementCostEst: 2,
        replacementYear: 2030,
        expectedLifeYears: null,
        installedDate: null,
        commissionedDate: null,
      },
      now,
    );
    expect(life.ageYears).toBeNull();
    expect(life.remainingLifeYears).toBeNull();
  });

  it("leaves maintenance to date null until M5 has work orders to add up", () => {
    const life = wholeLifeOf(
      {
        capitalCost: 1,
        replacementCostEst: 2,
        replacementYear: 2030,
        expectedLifeYears: 10,
        installedDate: "2020-01-01",
        commissionedDate: null,
      },
      now,
    );
    // Null and not zero: nothing has been counted, which is not the same as
    // nothing having been spent.
    expect(life.maintenanceToDate).toBeNull();
  });
});

describe("buildHistory", () => {
  const empty = {
    assetId: "a1",
    audit: [],
    readings: [],
    documents: [],
    project: null,
    contract: null,
    permits: [],
  };

  it("is newest first", () => {
    const history = buildHistory({
      ...empty,
      audit: [
        {
          action: "INSERT",
          at: "2026-01-01T10:00:00.000Z",
          actorName: "Ανδρέας Παπαδόπουλος",
          beforeCondition: null,
          afterCondition: null,
        },
      ],
      readings: [
        {
          at: "2026-06-01T10:00:00.000Z",
          readingType: "RUN_HOURS",
          value: 12000,
          unit: "h",
          takenByName: "Μιχάλης Κυριάκου",
        },
      ],
    });
    expect(history.map((entry) => entry.kind)).toEqual(["READING", "CREATED"]);
  });

  it("calls a change of band CONDITION and every other change UPDATED", () => {
    const history = buildHistory({
      ...empty,
      audit: [
        {
          action: "UPDATE",
          at: "2026-05-01T10:00:00.000Z",
          actorName: "Μιχάλης Κυριάκου",
          beforeCondition: "B",
          afterCondition: "C",
        },
        {
          action: "UPDATE",
          at: "2026-04-01T10:00:00.000Z",
          actorName: "Ανδρέας Παπαδόπουλος",
          beforeCondition: "B",
          afterCondition: "B",
        },
      ],
    });
    expect(history[0]).toMatchObject({
      kind: "CONDITION",
      summaryEl: "Φυσική κατάσταση: από B σε C",
    });
    expect(history[1].kind).toBe("UPDATED");
  });

  it("carries the project, the contract and the permits with a link to each record", () => {
    const history = buildHistory({
      ...empty,
      project: {
        id: "p1",
        code: "NGH-2026-007",
        titleEl: "Αντικατάσταση κλιματιστικών μονάδων",
        at: "2026-02-01T00:00:00.000Z",
      },
      contract: {
        id: "c1",
        ref: "CAP-2026-0007",
        titleEl: "ΤΥ/2026/112",
        at: "2026-03-01T00:00:00.000Z",
      },
      permits: [
        {
          id: "pm1",
          ref: "PTW-NGH-2026-004",
          titleEl: "Διακοπή ιατρικών αερίων",
          status: "ACTIVE",
          at: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
    expect(history.map((entry) => [entry.kind, entry.href])).toEqual([
      ["PERMIT", "/permits/pm1"],
      ["CONTRACT", "/contracts/c1"],
      ["PROJECT", "/projects/p1"],
    ]);
    expect(history[2].summaryEl).toContain("NGH-2026-007");
  });

  it("says whether an asset's paper has a protocol number yet", () => {
    const history = buildHistory({
      ...empty,
      documents: [
        {
          at: "2026-03-02T00:00:00.000Z",
          kind: "COMMISSIONING",
          titleEl: "Πρωτόκολλο παραλαβής",
          protocolNumber: "ΤΥ/2026/00412",
        },
        {
          at: "2026-03-01T00:00:00.000Z",
          kind: "OM_MANUAL",
          titleEl: "Εγχειρίδιο κατασκευαστή",
          protocolNumber: null,
        },
      ],
    });
    expect(history[0].summaryEl).toContain("ΤΥ/2026/00412");
    expect(history[1].summaryEl).toContain("σε αναμονή πρωτοκόλλου");
  });

  it("returns what exists and leaves work orders and defects to M5", () => {
    const history = buildHistory({
      ...empty,
      audit: [
        {
          action: "INSERT",
          at: "2026-01-01T10:00:00.000Z",
          actorName: null,
          beforeCondition: null,
          afterCondition: null,
        },
      ],
    });
    expect(history.map((entry) => entry.kind)).not.toContain("WORK_ORDER");
    expect(history.map((entry) => entry.kind)).not.toContain("DEFECT");
    expect(history).toHaveLength(1);
  });
});
