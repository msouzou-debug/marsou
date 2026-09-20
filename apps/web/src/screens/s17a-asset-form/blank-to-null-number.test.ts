import { describe, expect, it } from "vitest";
import { blankToNullNumber } from "./AssetForm";

describe("blankToNullNumber", () => {
  it("treats blank, null and undefined as not given, never as 0", () => {
    expect(blankToNullNumber("")).toBeNull();
    expect(blankToNullNumber(null)).toBeNull();
    expect(blankToNullNumber(undefined)).toBeNull();
  });
  it("keeps a real number, including a genuine 0", () => {
    expect(blankToNullNumber("0")).toBe(0);
    expect(blankToNullNumber("2031")).toBe(2031);
    expect(blankToNullNumber(12)).toBe(12);
    expect(blankToNullNumber("abc")).toBeNull();
  });
});
