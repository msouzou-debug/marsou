import { describe, expect, it } from "vitest";
import { loadHelpSection } from "./load-section";

describe("loadHelpSection", () => {
  it("returns null for a route that has no entry in help/map.json", () => {
    const result = loadHelpSection("/does-not-exist", "el");
    expect(result.markdown).toBeNull();
    expect(result.personas).toEqual([]);
  });

  it("returns the Greek Markdown for S01 (\"/\")", () => {
    const result = loadHelpSection("/", "el");
    expect(result.markdown).not.toBeNull();
    expect(result.markdown).toContain("# Χαρτοφυλάκιο έργων");
    expect(result.personas).toEqual(["estates_head", "executive_readonly", "finance"]);
    expect(result.tier).toBe("day-one");
  });

  it("returns the screen's tier for an optional screen (S06 risks and issues)", () => {
    const result = loadHelpSection("/projects/[id]/risks", "el");
    expect(result.tier).toBe("optional");
  });

  it("returns the English Markdown for S01 (\"/\")", () => {
    const result = loadHelpSection("/", "en");
    expect(result.markdown).not.toBeNull();
    expect(result.markdown).toContain("# Portfolio");
  });
});
