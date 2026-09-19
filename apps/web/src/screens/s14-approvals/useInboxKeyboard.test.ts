import { describe, expect, it, vi } from "vitest";
import { handleInboxKeydown } from "./useInboxKeyboard";

function fire(k: string, handlers: Parameters<typeof handleInboxKeydown>[1], target: EventTarget = document.body) {
  const event = new KeyboardEvent("keydown", { key: k, cancelable: true, bubbles: true });
  Object.defineProperty(event, "target", { value: target });
  handleInboxKeydown(event, handlers);
}

describe("handleInboxKeydown", () => {
  it("moves focus down and up", () => {
    const onMoveFocus = vi.fn();
    const handlers = { onMoveFocus, onOpenFocused: vi.fn(), onToggleHelp: vi.fn() };
    fire("ArrowDown", handlers);
    fire("ArrowUp", handlers);
    expect(onMoveFocus).toHaveBeenNthCalledWith(1, 1);
    expect(onMoveFocus).toHaveBeenNthCalledWith(2, -1);
  });

  it("opens the focused row on Enter", () => {
    const onOpenFocused = vi.fn();
    fire("Enter", { onMoveFocus: vi.fn(), onOpenFocused, onToggleHelp: vi.fn() });
    expect(onOpenFocused).toHaveBeenCalledTimes(1);
  });

  it("toggles the shortcuts overlay on ?", () => {
    const onToggleHelp = vi.fn();
    fire("?", { onMoveFocus: vi.fn(), onOpenFocused: vi.fn(), onToggleHelp });
    expect(onToggleHelp).toHaveBeenCalledTimes(1);
  });

  it("ignores every key while focus is inside a form control", () => {
    const onMoveFocus = vi.fn();
    const input = document.createElement("input");
    fire("ArrowDown", { onMoveFocus, onOpenFocused: vi.fn(), onToggleHelp: vi.fn() }, input);
    expect(onMoveFocus).not.toHaveBeenCalled();
  });
});
