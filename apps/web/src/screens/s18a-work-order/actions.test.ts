import { describe, expect, it } from "vitest";
import { WORK_ORDER_TRANSITIONS, WorkOrderStatus } from "@ecapital/shared";
import { availableActions, codesComplete, dateInputToIso, isClosed, needsCodes } from "./actions";

describe("availableActions", () => {
  // RULE: the buttons are the API's own transition table, never a superset.
  it("is exactly WORK_ORDER_TRANSITIONS for a corrective order", () => {
    for (const status of WorkOrderStatus.options) {
      expect(availableActions(status, "CORRECTIVE", true)).toEqual(WORK_ORDER_TRANSITIONS[status]);
      expect(availableActions(status, "STATUTORY", true)).toEqual(WORK_ORDER_TRANSITIONS[status]);
    }
  });

  it("never offers ACKNOWLEDGE or RESTORE on a PM order, and nothing else beyond the table", () => {
    for (const status of WorkOrderStatus.options) {
      const pm = availableActions(status, "PM", true);
      expect(pm).not.toContain("ACKNOWLEDGE");
      expect(pm).not.toContain("RESTORE");
      for (const action of pm) expect(WORK_ORDER_TRANSITIONS[status]).toContain(action);
    }
    expect(availableActions("OPEN", "PM", true)).toEqual(["START", "CANCEL"]);
    expect(availableActions("IN_PROGRESS", "PM", true)).toEqual(["PAUSE", "COMPLETE"]);
  });

  it("offers nothing to a role that cannot work orders", () => {
    expect(availableActions("OPEN", "CORRECTIVE", false)).toEqual([]);
  });
});

describe("completion rules", () => {
  it("needs the three codes on a corrective order only", () => {
    expect(needsCodes("CORRECTIVE")).toBe(true);
    expect(needsCodes("PM")).toBe(false);
    expect(needsCodes("STATUTORY")).toBe(false);
    expect(codesComplete({ failureCode: "LEAK", causeCode: "WEAR", remedyCode: "" })).toBe(false);
    expect(codesComplete({ failureCode: "LEAK", causeCode: "WEAR", remedyCode: "REPAIR" })).toBe(true);
  });

  it("knows a closed order", () => {
    expect(isClosed("COMPLETED")).toBe(true);
    expect(isClosed("CANCELLED")).toBe(true);
    expect(isClosed("RESTORED")).toBe(false);
  });

  it("turns a picked date into an instant on the same Nicosia day", () => {
    expect(dateInputToIso("2026-10-08").slice(0, 10)).toBe("2026-10-08");
    expect(dateInputToIso("2026-01-15").slice(0, 10)).toBe("2026-01-15");
  });
});
