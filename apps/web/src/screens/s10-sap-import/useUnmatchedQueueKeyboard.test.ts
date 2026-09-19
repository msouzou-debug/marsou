import { describe, expect, it, vi } from "vitest";
import { handleQueueKeydown, type UnmatchedQueueKeyboardHandlers } from "./useUnmatchedQueueKeyboard";

function handlers(): UnmatchedQueueKeyboardHandlers {
  return {
    onMoveFocus: vi.fn(),
    onAcceptTop: vi.fn(),
    onPickSuggestion: vi.fn(),
    onSkip: vi.fn(),
    onToggleSelect: vi.fn(),
    onBulkAssign: vi.fn(),
  };
}

function key(key: string, options: Partial<KeyboardEventInit> = {}, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, ...options });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("useUnmatchedQueueKeyboard's key map", () => {
  it("ArrowDown moves focus forward", () => {
    const h = handlers();
    handleQueueKeydown(key("ArrowDown"), h);
    expect(h.onMoveFocus).toHaveBeenCalledWith(1);
  });

  it("ArrowUp moves focus backward", () => {
    const h = handlers();
    handleQueueKeydown(key("ArrowUp"), h);
    expect(h.onMoveFocus).toHaveBeenCalledWith(-1);
  });

  it("Enter accepts the top suggestion", () => {
    const h = handlers();
    handleQueueKeydown(key("Enter"), h);
    expect(h.onAcceptTop).toHaveBeenCalledOnce();
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])("digit %s picks suggestion index %s - 1", (digit) => {
    const h = handlers();
    handleQueueKeydown(key(String(digit)), h);
    expect(h.onPickSuggestion).toHaveBeenCalledWith(digit - 1);
  });

  it("0 does nothing (only 1-9 are valid picks)", () => {
    const h = handlers();
    handleQueueKeydown(key("0"), h);
    expect(h.onPickSuggestion).not.toHaveBeenCalled();
  });

  it("'s' skips the focused row", () => {
    const h = handlers();
    handleQueueKeydown(key("s"), h);
    expect(h.onSkip).toHaveBeenCalledOnce();
  });

  it("Space toggles selection and is prevented (no page scroll)", () => {
    const h = handlers();
    const event = key(" ");
    handleQueueKeydown(event, h);
    expect(h.onToggleSelect).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("Shift+A opens bulk assign", () => {
    const h = handlers();
    handleQueueKeydown(key("A", { shiftKey: true }), h);
    expect(h.onBulkAssign).toHaveBeenCalledOnce();
  });

  it("'a' without Shift does not open bulk assign", () => {
    const h = handlers();
    handleQueueKeydown(key("a", { shiftKey: false }), h);
    expect(h.onBulkAssign).not.toHaveBeenCalled();
  });

  // RULE: every shortcut is inert while typing in a form control.
  it("ignores every key while the target is an <input>", () => {
    const input = document.createElement("input");
    const h = handlers();
    handleQueueKeydown(key("s", {}, input), h);
    handleQueueKeydown(key("ArrowDown", {}, input), h);
    handleQueueKeydown(key(" ", {}, input), h);
    handleQueueKeydown(key("A", { shiftKey: true }, input), h);
    expect(h.onSkip).not.toHaveBeenCalled();
    expect(h.onMoveFocus).not.toHaveBeenCalled();
    expect(h.onToggleSelect).not.toHaveBeenCalled();
    expect(h.onBulkAssign).not.toHaveBeenCalled();
  });

  it("ignores every key while the target is a <textarea>", () => {
    const textarea = document.createElement("textarea");
    const h = handlers();
    handleQueueKeydown(key("1", {}, textarea), h);
    expect(h.onPickSuggestion).not.toHaveBeenCalled();
  });

  it("an unrelated key does nothing", () => {
    const h = handlers();
    handleQueueKeydown(key("q"), h);
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });
});
