import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isoInstantToLocalInput, localInputToIsoInstant } from "./datetime";

/**
 * Both directions read the runtime's own offset (this module's header
 * comment), so the tests pin one with `process.env.TZ` before any `Date` in
 * the suite is created — Node re-reads it per call, so a process pinned to
 * Europe/Nicosia behaves exactly like a browser running there.
 */
describe("datetime — datetime-local ↔ ISO instant (S11a step 3, R19)", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Europe/Nicosia";
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("converts a datetime-local value with the summer offset (EEST, UTC+3)", () => {
    // The 19/09/2026 e2e case: entered 08:00–16:00 on 1 April.
    expect(localInputToIsoInstant("2026-04-01T08:00")).toBe("2026-04-01T05:00:00.000Z");
    expect(localInputToIsoInstant("2026-04-01T16:00")).toBe("2026-04-01T13:00:00.000Z");
  });

  it("converts a datetime-local value with the winter offset (EET, UTC+2)", () => {
    expect(localInputToIsoInstant("2026-01-15T09:30")).toBe("2026-01-15T07:30:00.000Z");
  });

  it("converts an ISO instant back to the local wall clock, not a slice of the UTC string", () => {
    // .slice(0, 16) on the instant below would read "2026-04-01T05:00" —
    // the exact bug the screenshot showed.
    expect(isoInstantToLocalInput("2026-04-01T05:00:00.000Z")).toBe("2026-04-01T08:00");
    expect(isoInstantToLocalInput("2026-01-15T07:30:00.000Z")).toBe("2026-01-15T09:30");
  });

  it("round-trips a value entered in the wizard back to itself", () => {
    const entered = "2026-04-01T08:00";
    expect(isoInstantToLocalInput(localInputToIsoInstant(entered))).toBe(entered);
  });

  it("returns an empty string for an instant that does not parse", () => {
    expect(isoInstantToLocalInput("not-a-date")).toBe("");
  });
});
