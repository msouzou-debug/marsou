import { describe, expect, it } from "vitest";
import { listScreensByTier } from "./list-screens-by-tier";
import helpMap from "./map.json";

describe("listScreensByTier", () => {
  it("puts S01 (day-one) in dayOne with its title and personas", () => {
    const { dayOne } = listScreensByTier("el");
    const s01 = dayOne.find((s) => s.id === "S01");
    expect(s01).toBeDefined();
    expect(s01?.title).toBe("Χαρτοφυλάκιο έργων");
    expect(s01?.persona).toEqual(["estates_head", "executive_readonly", "finance"]);
  });

  it("puts S06 (optional) in optional, not dayOne", () => {
    const { dayOne, optional } = listScreensByTier("el");
    expect(dayOne.find((s) => s.id === "S06")).toBeUndefined();
    expect(optional.find((s) => s.id === "S06")).toBeDefined();
  });

  it("collapses S09 / S09-new / S09-detail into one dayOne row", () => {
    const { dayOne } = listScreensByTier("el");
    const rows = dayOne.filter((s) => s.id.startsWith("S09") && !s.id.startsWith("S09a"));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("S09");
  });

  it("reads the English title for the same section", () => {
    const { dayOne } = listScreensByTier("en");
    const s01 = dayOne.find((s) => s.id === "S01");
    expect(s01?.title).toBe("Portfolio");
  });

  it("orders each group by screen id (S02 before S02a-* before S03)", () => {
    // The S02a-project-form section is named by both S02a-new and
    // S02a-edit; the lower-sorting id ("edit" < "new") represents it, the
    // same convention scripts/build-guides.mjs's collectPersonaChapters uses.
    const { dayOne } = listScreensByTier("el");
    const ids = dayOne.map((s) => s.id);
    expect(ids).toContain("S02a-edit");
    expect(ids.indexOf("S02")).toBeLessThan(ids.indexOf("S02a-edit"));
    expect(ids.indexOf("S02a-edit")).toBeLessThan(ids.indexOf("S03"));
  });

  it("every screen in help/map.json lands in exactly one group", () => {
    const sectionCount = new Set(Object.values(helpMap).map((e) => e.section)).size;
    const { dayOne, optional } = listScreensByTier("el");
    expect(dayOne.length + optional.length).toBe(sectionCount);
  });
});
