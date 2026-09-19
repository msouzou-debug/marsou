import type { AreaType, IcraClass } from "@ecapital/shared";
import { describe, expect, it } from "vitest";
import { ilsmFor, MANDATORY_MEASURES } from "./ilsm";
import { durationHours, routeFor, type RoutingFacts } from "./routing";
import {
  APPROVAL_SLA_WORKING_DAYS,
  addWorkingDays,
  approvalSlaState,
  approvalSlaWindow,
  isWorkingDay,
} from "./permit-sla";
import { findClashes, overlaps, type ClashCandidate } from "./clashes";
import { checklistComplete, highestOf, insideWindow, hasOverrun } from "./permit-rows";

/** R21, R22, R23, R25 — the rules of §6.3 to §6.7, with no database in sight. */

const areaOf = (areaId: string, areaType: AreaType) => ({
  areaId,
  areaNameEl: areaId,
  areaType,
});

function facts(over: Partial<RoutingFacts> = {}): RoutingFacts {
  return {
    icraClass: "I" as IcraClass,
    areas: [areaOf("plant", "PLANT")],
    ilsmRequired: false,
    durationHours: 4,
    directorThresholdHours: 72,
    ...over,
  };
}

const roles = (route: ReturnType<typeof routeFor>) => route.map((line) => line.role);

describe("the approval route (R22, §6.4)", () => {
  it("always puts Technical Services on it", () => {
    expect(roles(routeFor(facts()))).toEqual(["TECHNICAL"]);
  });

  it("adds Infection Control from Class III up, and not below it", () => {
    expect(roles(routeFor(facts({ icraClass: "II" })))).not.toContain("INFECTION_CONTROL");
    expect(roles(routeFor(facts({ icraClass: "III" })))).toContain("INFECTION_CONTROL");
    expect(roles(routeFor(facts({ icraClass: "IV" })))).toContain("INFECTION_CONTROL");
    expect(roles(routeFor(facts({ icraClass: "V" })))).toContain("INFECTION_CONTROL");
  });

  it("adds one ward manager line per clinical area touched", () => {
    const route = routeFor(
      facts({
        areas: [
          areaOf("theatre-1", "THEATRE"),
          areaOf("theatre-2", "THEATRE"),
          areaOf("plant", "PLANT"),
        ],
      }),
    );
    const wards = route.filter((line) => line.role === "WARD_MANAGER");
    expect(wards.map((line) => line.areaId)).toEqual(["theatre-1", "theatre-2"]);
    expect(wards.every((line) => line.reason === "clinicalAreaTouched")).toBe(true);
  });

  it("counts THEATRE, ICU, WARD, OPD and LAB as clinical, and nothing else", () => {
    const clinical: AreaType[] = ["THEATRE", "ICU", "WARD", "OPD", "LAB"];
    const other: AreaType[] = ["PLANT", "OFFICE", "OTHER"];
    for (const areaType of clinical) {
      expect(roles(routeFor(facts({ areas: [areaOf("x", areaType)] })))).toContain("WARD_MANAGER");
    }
    for (const areaType of other) {
      expect(roles(routeFor(facts({ areas: [areaOf("x", areaType)] })))).not.toContain(
        "WARD_MANAGER",
      );
    }
  });

  it("adds Nursing once when an inpatient area is touched", () => {
    expect(roles(routeFor(facts({ areas: [areaOf("opd", "OPD")] })))).not.toContain("NURSING");
    const route = routeFor(
      facts({ areas: [areaOf("ward", "WARD"), areaOf("icu", "ICU")] }),
    );
    expect(route.filter((line) => line.role === "NURSING")).toHaveLength(1);
  });

  it("adds Safety when ILSM is required — ASSUMPTION, ADR-0026", () => {
    expect(roles(routeFor(facts()))).not.toContain("SAFETY");
    const route = routeFor(facts({ ilsmRequired: true }));
    expect(roles(route)).toContain("SAFETY");
    expect(route.find((line) => line.role === "SAFETY")?.reason).toBe("ilsmRequired");
  });

  it("adds the Hospital Director on Class V", () => {
    const route = routeFor(facts({ icraClass: "V" }));
    expect(route.find((line) => line.role === "HOSPITAL_DIRECTOR")?.reason).toBe("classFive");
  });

  it("adds the Hospital Director past the duration threshold, and not at it", () => {
    expect(roles(routeFor(facts({ durationHours: 72 })))).not.toContain("HOSPITAL_DIRECTOR");
    const route = routeFor(facts({ durationHours: 72.5 }));
    expect(route.find((line) => line.role === "HOSPITAL_DIRECTOR")?.reason).toBe(
      "durationAboveThreshold",
    );
  });

  it("follows a threshold somebody lowered, because lowering it only adds approvers", () => {
    const route = routeFor(facts({ durationHours: 30, directorThresholdHours: 24 }));
    expect(roles(route)).toContain("HOSPITAL_DIRECTOR");
  });

  it("puts one director line on a long Class V, and calls it Class V", () => {
    const route = routeFor(facts({ icraClass: "V", durationHours: 200 }));
    const director = route.filter((line) => line.role === "HOSPITAL_DIRECTOR");
    expect(director).toHaveLength(1);
    expect(director[0].reason).toBe("classFive");
  });

  it("routes the M3 definition-of-done case: Class IV across a theatre and an ICU", () => {
    const route = routeFor(
      facts({
        icraClass: "IV",
        areas: [areaOf("plant", "PLANT"), areaOf("theatre", "THEATRE"), areaOf("icu", "ICU")],
        durationHours: 8,
      }),
    );
    expect(roles(route)).toEqual([
      "INFECTION_CONTROL",
      "WARD_MANAGER",
      "WARD_MANAGER",
      "NURSING",
      "TECHNICAL",
    ]);
  });

  it("measures the window in hours, which is what the threshold compares", () => {
    expect(durationHours("2026-03-01T08:00:00Z", "2026-03-01T20:00:00Z")).toBe(12);
    expect(durationHours("2026-03-01T08:00:00Z", "2026-03-05T08:00:00Z")).toBe(96);
  });
});

describe("ILSM (R21, §6.3)", () => {
  it("is not required when nothing was ticked and fire is untouched", () => {
    const check = ilsmFor([], ["WATER"]);
    expect(check.required).toBe(false);
    expect(check.measures).toEqual([]);
  });

  it("is required on any one trigger, with all four mandatory measures", () => {
    const check = ilsmFor(["EXITS"], ["ELECTRICAL"]);
    expect(check.required).toBe(true);
    expect(check.measures).toEqual(MANDATORY_MEASURES);
    expect(check.measures).toEqual([
      "INTERIM_MEASURES_LIST",
      "FIRE_WATCH",
      "EXTRA_DRILLS",
      "NOTIFY_FIRE_OFFICER",
    ]);
  });

  it("treats a fire-system shutdown as a trigger whatever the form says", () => {
    const check = ilsmFor([], ["FIRE"]);
    expect(check.required).toBe(true);
    expect(check.triggers).toEqual(["FIRE_DETECTION", "FIRE_SUPPRESSION"]);
  });

  it("never invents the fire officer's own notification time", () => {
    expect(ilsmFor(["COMPARTMENTATION"], []).fireOfficerNotifiedAt).toBeNull();
  });
});

describe("the approval clock (R22, ADR-0017's thresholds)", () => {
  it("defaults to two working days", () => {
    expect(APPROVAL_SLA_WORKING_DAYS).toBe(2);
  });

  it("skips the weekend: Friday plus two working days is Tuesday", () => {
    // 2026-03-06 is a Friday.
    const friday = new Date("2026-03-06T09:00:00Z");
    expect(isWorkingDay(friday)).toBe(true);
    const due = addWorkingDays(friday, 2);
    expect(due.toISOString()).toBe("2026-03-10T09:00:00.000Z");
  });

  it("keeps a Monday submission inside the week", () => {
    const monday = new Date("2026-03-09T09:00:00Z");
    expect(addWorkingDays(monday, 2).toISOString()).toBe("2026-03-11T09:00:00.000Z");
  });

  it("counts Saturday and Sunday as no days at all", () => {
    expect(isWorkingDay(new Date("2026-03-07T09:00:00Z"))).toBe(false);
    expect(isWorkingDay(new Date("2026-03-08T09:00:00Z"))).toBe(false);
  });

  it("stores the due moment and the length of the promise, not the band", () => {
    const window = approvalSlaWindow(new Date("2026-03-09T09:00:00Z"));
    expect(window.hours).toBe(48);
    expect(window.dueAt.toISOString()).toBe("2026-03-11T09:00:00.000Z");
  });

  it("gives a Friday line a longer clock in hours, which is the point of it", () => {
    expect(approvalSlaWindow(new Date("2026-03-06T09:00:00Z")).hours).toBe(96);
  });

  it("bands it exactly like an RFI, and stops the clock at the decision", () => {
    const due = new Date("2026-03-11T09:00:00Z");
    const fresh = new Date("2026-03-09T09:00:00Z");
    expect(approvalSlaState(due, 48, null, fresh)).toBe("GREEN");
    // Exactly half left belongs to the worse band.
    expect(approvalSlaState(due, 48, null, new Date("2026-03-10T09:00:00Z"))).toBe("AMBER");
    expect(approvalSlaState(due, 48, null, new Date("2026-03-11T09:00:00Z"))).toBe("BREACHED");
    // Decided with the whole window left: still GREEN a week later.
    expect(approvalSlaState(due, 48, fresh, new Date("2026-03-20T09:00:00Z"))).toBe("GREEN");
  });
});

describe("clash detection (R25, §6.7)", () => {
  const base = (over: Partial<ClashCandidate>): ClashCandidate => ({
    id: "subject",
    ref: null,
    orgUnitId: "nicosia-general",
    systems: ["MEDICAL_GAS"],
    areaIds: ["a1"],
    areaTypes: ["PLANT"],
    start: new Date("2026-03-09T08:00:00Z"),
    end: new Date("2026-03-09T18:00:00Z"),
    ...over,
  });

  it("calls a shared minute an overlap and a touching edge not one", () => {
    const a = base({});
    expect(
      overlaps(a, base({ id: "b", start: new Date("2026-03-09T17:00:00Z"), end: new Date("2026-03-09T20:00:00Z") })),
    ).toBe(true);
    expect(
      overlaps(a, base({ id: "b", start: new Date("2026-03-09T18:00:00Z"), end: new Date("2026-03-09T20:00:00Z") })),
    ).toBe(false);
  });

  it("finds the same area closed twice over", () => {
    const clashes = findClashes(base({}), [base({ id: "other", ref: "PTW-NGH-2026-002" })]);
    expect(clashes).toEqual([
      {
        kind: "SAME_AREA_OVERLAP",
        otherPermitId: "other",
        otherPermitRef: "PTW-NGH-2026-002",
        messageKey: "permitClash.SAME_AREA_OVERLAP",
      },
    ]);
  });

  it("finds two theatres down in one hospital at once", () => {
    const subject = base({ areaIds: ["t1"], areaTypes: ["THEATRE"] });
    const other = base({ id: "other", areaIds: ["t2"], areaTypes: ["THEATRE"], systems: ["HVAC"] });
    expect(findClashes(subject, [other])[0].kind).toBe("TWO_THEATRES");
  });

  it("finds two permits on the same system — the redundant-halves seam until M4", () => {
    const subject = base({ areaIds: ["a1"] });
    const other = base({ id: "other", areaIds: ["a2"] });
    expect(findClashes(subject, [other])[0].kind).toBe("REDUNDANT_HALVES");
  });

  it("says nothing about a different unit, a different system or a different week", () => {
    const subject = base({});
    expect(findClashes(subject, [base({ id: "x", orgUnitId: "larnaca-general", areaIds: ["z"] })])).toEqual([]);
    expect(findClashes(subject, [base({ id: "y", systems: ["WATER"], areaIds: ["z"] })])).toEqual([]);
    expect(
      findClashes(subject, [
        base({
          id: "z",
          areaIds: ["z"],
          start: new Date("2026-04-09T08:00:00Z"),
          end: new Date("2026-04-09T18:00:00Z"),
        }),
      ]),
    ).toEqual([]);
  });

  it("reports one clash per other permit, worst kind first", () => {
    // Shares an area AND a system AND both are theatres: one warning.
    const subject = base({ areaIds: ["t1"], areaTypes: ["THEATRE"] });
    const other = base({ id: "other", areaIds: ["t1"], areaTypes: ["THEATRE"] });
    const clashes = findClashes(subject, [other]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].kind).toBe("SAME_AREA_OVERLAP");
  });

  it("never clashes with itself", () => {
    const subject = base({});
    expect(findClashes(subject, [subject])).toEqual([]);
  });
});

describe("the window and the checklist (§6.5, §6.6)", () => {
  const start = new Date("2026-03-09T08:00:00Z");
  const end = new Date("2026-03-09T18:00:00Z");

  it("is live inside the window, including both edges", () => {
    expect(insideWindow(start, start, end)).toBe(true);
    expect(insideWindow(new Date("2026-03-09T12:00:00Z"), start, end)).toBe(true);
    expect(insideWindow(end, start, end)).toBe(true);
  });

  it("is not live before it or after it", () => {
    expect(insideWindow(new Date("2026-03-09T07:59:59Z"), start, end)).toBe(false);
    expect(insideWindow(new Date("2026-03-09T18:00:01Z"), start, end)).toBe(false);
  });

  it("calls an overrun an overrun the second past the end", () => {
    expect(hasOverrun(end, end)).toBe(false);
    expect(hasOverrun(new Date("2026-03-09T18:00:01Z"), end)).toBe(true);
  });

  it("needs every box, and does not count the note as one", () => {
    const all = {
      barriersRemoved: true,
      areaCleaned: true,
      airBalanceRestored: true,
      systemsTestedAndReturned: true,
      fireSystemsReenabled: true,
      noteEl: null,
      clinicalAcceptanceById: null,
      clinicalAcceptanceByName: null,
      clinicalAcceptanceAt: null,
    };
    expect(checklistComplete(all)).toBe(true);
    expect(checklistComplete({ ...all, fireSystemsReenabled: false })).toBe(false);
    expect(checklistComplete({ ...all, airBalanceRestored: false })).toBe(false);
  });

  it("reports the worst risk band on the list row", () => {
    expect(highestOf(["LOW", "HIGH", null, "MEDIUM"])).toBe("HIGH");
    expect(highestOf([null, null])).toBeNull();
    expect(highestOf(["HIGHEST", "HIGH"])).toBe("HIGHEST");
  });
});
