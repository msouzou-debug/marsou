import { describe, expect, it } from "vitest";
import {
  type DirectoryUser,
  escapeFilterValue,
  formatObjectGuid,
  splitUsername,
  subjectFor,
} from "./directory";

/**
 * ADR-0018. The string work that decides whether a bind reaches the right
 * account and whether the same person keeps the same eCapital identity — all
 * of it pure, so it is tested here rather than against a server.
 */
describe("splitUsername", () => {
  it("makes a UPN out of a bare account name", () => {
    expect(splitUsername("apapadopoulos", "ihcis.local")).toEqual({
      upn: "apapadopoulos@ihcis.local",
      uid: "apapadopoulos",
    });
  });

  it("leaves a UPN the user typed alone", () => {
    expect(splitUsername("apapadopoulos@ihcis.local", "ihcis.local")).toEqual({
      upn: "apapadopoulos@ihcis.local",
      uid: "apapadopoulos",
    });
  });

  it("accepts the old domain logon form", () => {
    expect(splitUsername("IHCIS\\apapadopoulos", "ihcis.local")).toEqual({
      upn: "apapadopoulos@ihcis.local",
      uid: "apapadopoulos",
    });
  });

  it("ignores spaces either side", () => {
    expect(splitUsername("  echristodoulou  ", "ihcis.local").upn).toBe(
      "echristodoulou@ihcis.local",
    );
  });
});

describe("escapeFilterValue", () => {
  it("escapes the four characters that would change the filter", () => {
    expect(escapeFilterValue("a(b)c*d\\e")).toBe("a\\28b\\29c\\2ad\\5ce");
  });

  it("leaves an ordinary account name untouched", () => {
    expect(escapeFilterValue("apapadopoulos")).toBe("apapadopoulos");
  });
});

describe("formatObjectGuid", () => {
  it("prints AD's mixed-endian GUID the way every other tool prints it", () => {
    // The bytes AD stores for {FE352B0E-...}: first three groups little-endian.
    const bytes = new Uint8Array([
      0x0e, 0x2b, 0x35, 0xfe, 0x9c, 0x2a, 0x1d, 0x4c, 0x8d, 0x27, 0x4b, 0x1f, 0x2a, 0x3c, 0x4d,
      0x5e,
    ]);
    expect(formatObjectGuid(bytes)).toBe("fe352b0e-2a9c-4c1d-8d27-4b1f2a3c4d5e");
  });

  it("refuses anything that is not sixteen bytes", () => {
    expect(formatObjectGuid(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("subjectFor", () => {
  const base: DirectoryUser = {
    objectGuid: null,
    uid: "APapadopoulos",
    displayName: null,
    mail: null,
    memberOf: [],
  };

  it("uses the objectGUID when the directory gives one", () => {
    expect(subjectFor({ ...base, objectGuid: "fe352b0e-2a9c-4c1d-8d27-4b1f2a3c4d5e" })).toBe(
      "fe352b0e-2a9c-4c1d-8d27-4b1f2a3c4d5e",
    );
  });

  it("falls back to the account name, and says that is what it is", () => {
    expect(subjectFor(base)).toBe("ad:apapadopoulos");
  });
});
