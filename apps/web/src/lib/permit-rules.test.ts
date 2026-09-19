import { describe, expect, it } from "vitest";
import type { CloseoutChecklist, IcraControl } from "@ecapital/shared";
import {
  allControlsAcknowledged,
  canRemoveArea,
  closeoutComplete,
  permitBannerState,
  startWorkDisabledReasonKey,
} from "./permit-rules";

const CONTROLS: IcraControl[] = [
  { id: "IV-01", textEl: "a", textEn: "a", phase: "DURING" },
  { id: "IV-02", textEl: "b", textEn: "b", phase: "ON_COMPLETION" },
];

describe("allControlsAcknowledged", () => {
  it("is false with no controls at all (nothing to acknowledge is not a pass)", () => {
    expect(allControlsAcknowledged([], [])).toBe(false);
  });
  it("is false until every control id is acknowledged", () => {
    expect(allControlsAcknowledged(CONTROLS, ["IV-01"])).toBe(false);
  });
  it("is true once every control id is acknowledged, in any order", () => {
    expect(allControlsAcknowledged(CONTROLS, ["IV-02", "IV-01"])).toBe(true);
  });
});

describe("canRemoveArea", () => {
  it("allows removing a direct area only", () => {
    expect(canRemoveArea("DIRECT")).toBe(true);
    expect(canRemoveArea("INDIRECT")).toBe(false);
  });
});

describe("startWorkDisabledReasonKey", () => {
  const start = "2026-03-14T08:00:00.000Z";
  const end = "2026-03-14T16:00:00.000Z";
  it("refuses a permit that is not APPROVED", () => {
    expect(startWorkDisabledReasonKey("SUBMITTED", start, end, new Date(start))).toBe("notApproved");
  });
  it("refuses before the planned window opens", () => {
    expect(startWorkDisabledReasonKey("APPROVED", start, end, new Date("2026-03-14T07:00:00.000Z"))).toBe(
      "beforeWindow",
    );
  });
  it("refuses after the planned window closes", () => {
    expect(startWorkDisabledReasonKey("APPROVED", start, end, new Date("2026-03-14T17:00:00.000Z"))).toBe(
      "afterWindow",
    );
  });
  it("allows starting inside the window", () => {
    expect(startWorkDisabledReasonKey("APPROVED", start, end, new Date("2026-03-14T09:00:00.000Z"))).toBeNull();
  });
});

const FULL_CHECKLIST: CloseoutChecklist = {
  barriersRemoved: true,
  areaCleaned: true,
  airBalanceRestored: true,
  systemsTestedAndReturned: true,
  fireSystemsReenabled: true,
  noteEl: null,
  clinicalAcceptanceById: "user-1",
  clinicalAcceptanceByName: "Μ. Ιωάννου",
  clinicalAcceptanceAt: "2026-03-14T18:00:00.000Z",
};

describe("closeoutComplete", () => {
  it("requires every box plus the clinical acceptance", () => {
    expect(closeoutComplete(FULL_CHECKLIST)).toBe(true);
    expect(closeoutComplete({ ...FULL_CHECKLIST, fireSystemsReenabled: false })).toBe(false);
    expect(closeoutComplete({ ...FULL_CHECKLIST, clinicalAcceptanceById: null })).toBe(false);
  });
});

describe("permitBannerState", () => {
  it("maps the eight-value status onto the banner's four states", () => {
    expect(permitBannerState("SUBMITTED")).toBe("pendingApproval");
    expect(permitBannerState("CLINICAL_REVIEW")).toBe("pendingApproval");
    expect(permitBannerState("APPROVED")).toBe("inForce");
    expect(permitBannerState("ACTIVE")).toBe("inForce");
    expect(permitBannerState("BREACH")).toBe("expired");
    expect(permitBannerState("REJECTED")).toBe("revoked");
  });
  it("shows no banner for CLOSED or DRAFT", () => {
    expect(permitBannerState("CLOSED")).toBeNull();
    expect(permitBannerState("DRAFT")).toBeNull();
  });
});
