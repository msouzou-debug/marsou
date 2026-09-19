"use client";

// S10 — R14
//
/**
 * useUnmatchedQueueKeyboard — every keyboard shortcut the S10 unmatched
 * queue answers to, in one place, so the key map is unit-tested once
 * (`useUnmatchedQueueKeyboard.test.ts`) instead of being re-derived from the
 * screen's own event handlers. `KeyboardHintBar` is this hook's read-only
 * mirror — the two must never drift, which is why both live under
 * `screens/s10-sap-import` next to each other.
 *
 * `↓`/`↑` move focus · `Enter` accepts the top suggestion · `1`–`9` pick a
 * numbered suggestion · `s` skips the focused row · `Space` toggles its
 * checkbox · `Shift+A` opens bulk-assign for the current selection.
 *
 * RULE: every shortcut is inert while focus sits inside a form control
 * (an `<input>`, `<textarea>`, `<select>` or anything `contenteditable`) —
 * the same restraint `DecisionPanel`'s header comment states for its own
 * `a`/`r`/`f`/`x` keys — so typing "s" into the bulk-assign search box never
 * skips a row, and `disabled` (the bulk-assign picker or another dialog is
 * open) turns every key off outright.
 */
import { useEffect } from "react";

export interface UnmatchedQueueKeyboardHandlers {
  onMoveFocus: (direction: 1 | -1) => void;
  onAcceptTop: () => void;
  onPickSuggestion: (index: number) => void;
  onSkip: () => void;
  onToggleSelect: () => void;
  onBulkAssign: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** Exported for the unit test to drive directly, without faking a DOM event dispatch for every key. */
export function handleQueueKeydown(event: KeyboardEvent, handlers: UnmatchedQueueKeyboardHandlers): void {
  if (isTypingTarget(event.target)) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    handlers.onMoveFocus(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    handlers.onMoveFocus(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    handlers.onAcceptTop();
  } else if (/^[1-9]$/.test(event.key)) {
    event.preventDefault();
    handlers.onPickSuggestion(Number(event.key) - 1);
  } else if (event.key === "s" || event.key === "S") {
    event.preventDefault();
    handlers.onSkip();
  } else if (event.key === " " || event.code === "Space") {
    event.preventDefault();
    handlers.onToggleSelect();
  } else if ((event.key === "A" || event.key === "a") && event.shiftKey) {
    event.preventDefault();
    handlers.onBulkAssign();
  }
}

export function useUnmatchedQueueKeyboard(handlers: UnmatchedQueueKeyboardHandlers, disabled = false): void {
  useEffect(() => {
    if (disabled) return;
    function onKeyDown(event: KeyboardEvent) {
      handleQueueKeydown(event, handlers);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, handlers]);
}
