import { describe, expect, it } from "vitest";
import { renderWithIntl } from "@/test/render";
import { KeyboardHintBar } from "./KeyboardHintBar";

describe("KeyboardHintBar", () => {
  it("names every key the queue answers to", () => {
    renderWithIntl(<KeyboardHintBar />);
    const text = document.body.textContent ?? "";
    for (const key of ["↓", "↑", "Enter", "1–9", "s", "Space", "Shift+A"]) {
      expect(text).toContain(key);
    }
  });

  it("shows the selected count next to the bulk-assign key once something is selected", () => {
    renderWithIntl(<KeyboardHintBar selectedCount={3} />);
    expect(document.body.textContent).toContain("3");
  });
});
