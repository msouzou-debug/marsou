import { describe, expect, it } from "vitest";
import { type DelayInput, calendarDays, computeDelay, nicosiaToday, plusDays } from "./delay";

/**
 * ADR-0035 — the delay penalty, computed on read. No database: the rules are
 * a function of the rows, and the Larnaca figures the ΜΕΕ reported are the
 * fixture.
 */
const contract = {
  completionDate: "2026-03-01",
  liquidatedDamagesPerDay: 500,
  ldActivatedAt: null,
};

function input(overrides: Partial<DelayInput> = {}): DelayInput {
  return { contract, sections: [], extensions: [], claims: [], asOf: "2026-03-11", ...overrides };
}

const sectionA = {
  id: "sec-a",
  code: "Α",
  titleEl: "Τμήμα Α",
  completionDate: "2024-12-03",
  handoverDate: "2025-09-11",
  liquidatedDamagesPerDay: null,
  ldActivatedAt: "2025-07-21",
  sortOrder: 1,
};
const sectionB = {
  id: "sec-b",
  code: "Β",
  titleEl: "Τμήμα Β",
  completionDate: "2026-06-18",
  handoverDate: null,
  liquidatedDamagesPerDay: null,
  ldActivatedAt: null,
  sortOrder: 2,
};

describe("the delay penalty (ADR-0035)", () => {
  it("counts calendar days: Larnaca Section Α, 03/12/2024 to 11/09/2025, is 282 days and €282.000", () => {
    const delay = computeDelay(
      input({
        contract: { ...contract, liquidatedDamagesPerDay: 1000 },
        sections: [sectionA],
        asOf: "2026-11-09",
      }),
    );
    expect(delay.clocks).toHaveLength(1);
    const [a] = delay.clocks;
    expect(a.dueDate).toBe("2024-12-03");
    expect(a.handoverDate).toBe("2025-09-11");
    expect(a.daysLate).toBe(282);
    expect(a.ratePerDay).toBe(1000);
    expect(a.amount).toBe(282_000);
    expect(a.activatedAt).toBe("2025-07-21");
    expect(delay.totalAmount).toBe(282_000);
  });

  it("runs one clock per section and none for the contract when it has sections", () => {
    const delay = computeDelay(
      input({
        contract: { ...contract, liquidatedDamagesPerDay: 1000 },
        sections: [sectionB, sectionA],
        extensions: [{ sectionId: null, days: 10, contractorCulpable: false }],
        asOf: "2026-11-09",
      }),
    );
    // Sorted by sortOrder, the contract's own clock absent.
    expect(delay.clocks.map((c) => c.sectionCode)).toEqual(["Α", "Β"]);
    // Section Β is still open: 18/06/2026 to 09/11/2026 is 144 days.
    expect(delay.clocks[1].daysLate).toBe(144);
    expect(delay.clocks[1].handoverDate).toBeNull();
    expect(delay.totalDaysLate).toBe(282 + 144);
    expect(delay.totalAmount).toBe(426_000);
    // An extension on no section is the contract's, and still counts in the total.
    expect(delay.extensionDays).toBe(10);
  });

  it("runs the contract's own clock when it has no sections", () => {
    const delay = computeDelay(input());
    expect(delay.clocks).toHaveLength(1);
    expect(delay.clocks[0]).toMatchObject({
      sectionId: null,
      sectionCode: null,
      dueDate: "2026-03-01",
      daysLate: 10,
      ratePerDay: 500,
      amount: 5000,
    });
  });

  it("moves the due date by the extensions on that clock only", () => {
    const delay = computeDelay(
      input({
        contract: { ...contract, liquidatedDamagesPerDay: 1000 },
        sections: [sectionB],
        extensions: [
          { sectionId: "sec-b", days: 40, contractorCulpable: false },
          { sectionId: "elsewhere", days: 99, contractorCulpable: true },
        ],
        asOf: "2026-11-09",
      }),
    );
    const [b] = delay.clocks;
    expect(b.extensionDays).toBe(40);
    expect(b.dueDate).toBe("2026-07-28");
    expect(b.daysLate).toBe(104);
    expect(b.amount).toBe(104_000);
  });

  it("keeps the extension days judged the contractor's fault apart", () => {
    const delay = computeDelay(
      input({
        extensions: [
          { sectionId: null, days: 5, contractorCulpable: true },
          { sectionId: null, days: 3, contractorCulpable: false },
        ],
      }),
    );
    expect(delay.clocks[0].extensionDays).toBe(8);
    expect(delay.clocks[0].culpableExtensionDays).toBe(5);
    expect(delay.clocks[0].dueDate).toBe("2026-03-09");
    expect(delay.clocks[0].daysLate).toBe(2);
  });

  it("gives no amount without a rate, and a null total when no late clock has one", () => {
    const delay = computeDelay(input({ contract: { ...contract, liquidatedDamagesPerDay: null } }));
    expect(delay.clocks[0].daysLate).toBe(10);
    expect(delay.clocks[0].amount).toBeNull();
    expect(delay.totalDaysLate).toBe(10);
    expect(delay.totalAmount).toBeNull();
  });

  it("lets a section's own rate override the contract's", () => {
    const delay = computeDelay(
      input({
        contract: { ...contract, liquidatedDamagesPerDay: null },
        sections: [{ ...sectionA, liquidatedDamagesPerDay: 250 }],
      }),
    );
    expect(delay.clocks[0].amount).toBe(282 * 250);
  });

  it("stops the clock at the handover date", () => {
    const open = computeDelay(input({ asOf: "2026-04-01" }));
    const handed = computeDelay(
      input({ asOf: "2026-04-01", contract: { ...contract, handoverDate: "2026-03-05" } }),
    );
    expect(open.clocks[0].daysLate).toBe(31);
    expect(handed.clocks[0].daysLate).toBe(4);
    // Handed over before the due date is not late at all.
    const early = computeDelay(input({ contract: { ...contract, handoverDate: "2026-02-20" } }));
    expect(early.clocks[0].daysLate).toBe(0);
    expect(early.totalAmount).toBeNull();
  });

  it("gives a clock with no completion date no due date and no days", () => {
    const delay = computeDelay(input({ contract: { ...contract, completionDate: null } }));
    expect(delay.clocks[0].dueDate).toBeNull();
    expect(delay.clocks[0].daysLate).toBe(0);
  });

  it("counts the open claims and what each side claims in them", () => {
    const delay = computeDelay(
      input({
        claims: [
          { direction: "BY_CONTRACTOR", amount: 2_532_848.76, stage: "COURT" },
          { direction: "BY_ORGANISATION", amount: 2_508_506.69, stage: "COURT" },
          { direction: "BY_CONTRACTOR", amount: 10_000, stage: "SETTLED" },
          { direction: "BY_CONTRACTOR", amount: 5_000, stage: "WITHDRAWN" },
        ],
      }),
    );
    expect(delay.openClaims).toBe(2);
    expect(delay.claimedByContractor).toBe(2_532_848.76);
    expect(delay.claimedByOrganisation).toBe(2_508_506.69);
  });

  it("does the date arithmetic in whole calendar days", () => {
    expect(calendarDays("2024-12-03", "2025-09-11")).toBe(282);
    expect(plusDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(calendarDays("2026-03-29", "2026-03-30")).toBe(1); // across the clock change
  });

  it("reads today in Nicosia, not in UTC", () => {
    // 23:30 UTC on 9 November is already 10 November in Cyprus (UTC+2).
    expect(nicosiaToday(new Date("2026-11-09T23:30:00Z"))).toBe("2026-11-10");
    expect(nicosiaToday(new Date("2026-11-09T12:00:00Z"))).toBe("2026-11-09");
  });
});
