import { describe, expect, it } from "vitest";
import { EMPTY_WIZARD_DRAFT } from "./schema";
import { draftToBody } from "./PermitWizardScreen";

describe("draftToBody", () => {
  it("converts datetime-local strings to ISO, and leaves them undefined when not yet set", () => {
    const body = draftToBody(EMPTY_WIZARD_DRAFT);
    expect(body.plannedStart).toBeUndefined();
    expect(body.plannedEnd).toBeUndefined();
  });

  it("sends the areas and systems chosen so far as the draft body", () => {
    const body = draftToBody({
      ...EMPTY_WIZARD_DRAFT,
      systems: ["ELECTRICAL"],
      areaIds: ["a1", "a2"],
      titleEl: "Διακοπή",
      plannedStart: "2026-03-14T08:00",
      plannedEnd: "2026-03-14T16:00",
    });
    expect(body.systems).toEqual(["ELECTRICAL"]);
    expect(body.affectedAreaIds).toEqual(["a1", "a2"]);
    expect(body.plannedStart).toBe(new Date("2026-03-14T08:00").toISOString());
  });
});
