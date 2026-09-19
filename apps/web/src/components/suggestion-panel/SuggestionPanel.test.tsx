import { describe, expect, it, vi } from "vitest";
import type { Suggestion } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { SuggestionPanel } from "./SuggestionPanel";

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    projectId: "p-1",
    projectCode: "PRJ-031",
    projectTitleEl: "Αντικατάσταση ακτινολογικού εξοπλισμού",
    contractId: "c-1",
    contractRef: "CAP-2026-0012",
    confidence: "HIGH",
    reason: "SAME_WBS",
    ...overrides,
  };
}

describe("SuggestionPanel", () => {
  it("shows the empty message when there are no suggestions", () => {
    renderWithIntl(<SuggestionPanel suggestions={[]} onPick={vi.fn()} />);
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });

  it("shows the top suggestion's confidence as plain Greek text, not a percentage", () => {
    renderWithIntl(<SuggestionPanel suggestions={[suggestion()]} onPick={vi.fn()} />);
    expect(document.body.textContent).toContain("Υψηλή αντιστοιχία");
    expect(document.body.textContent).toContain("ίδιος κωδικός WBS");
    expect(document.body.textContent).not.toMatch(/%/);
  });

  it("numbers every suggestion 1..n and picks the right index on click", () => {
    const onPick = vi.fn();
    const list = [
      suggestion({ confidence: "HIGH" }),
      suggestion({ projectId: "p-2", projectCode: "PRJ-040", confidence: "MEDIUM", reason: "SAME_PO" }),
      suggestion({ projectId: "p-3", projectCode: "PRJ-055", confidence: "LOW", reason: "SIMILAR_TEXT" }),
    ];
    renderWithIntl(<SuggestionPanel suggestions={list} onPick={onPick} />);
    const buttons = document.querySelectorAll("ol button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.textContent).toContain("1");
    buttons[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onPick).toHaveBeenCalledWith(2);
  });

  it("caps at 9 without throwing when given exactly 9", () => {
    const list = Array.from({ length: 9 }, (_, i) => suggestion({ projectId: `p-${i}`, projectCode: `PRJ-${i}` }));
    renderWithIntl(<SuggestionPanel suggestions={list} onPick={vi.fn()} />);
    expect(document.querySelectorAll("ol button")).toHaveLength(9);
  });

  it("disables the shortlist while a pick is in flight", () => {
    renderWithIntl(<SuggestionPanel suggestions={[suggestion()]} onPick={vi.fn()} pickingIndex={0} />);
    expect(document.querySelector("ol button")?.hasAttribute("disabled")).toBe(true);
  });
});
