"use client";

// S14 — R22
//
/**
 * useInboxKeyboard — every keyboard shortcut the S14 approvals list answers
 * to when the DecisionPanel is closed, in one place, the same pattern
 * `screens/s10-sap-import/useUnmatchedQueueKeyboard.ts` sets: the key map is
 * unit tested once (`useInboxKeyboard.test.ts`) instead of re-derived from
 * the screen's own handlers.
 *
 * `↓`/`↑` move the focused row · `Enter` opens it · `?` toggles the
 * shortcuts overlay. `a`/`r`/`f`/`x` are not this hook's job once a row is
 * open — `DecisionPanel` already answers to them itself (its own header
 * comment); this hook is disabled the moment the panel opens, the same way
 * `useUnmatchedQueueKeyboard` disables itself while the bulk-assign picker
 * is open.
 *
 * RULE: every shortcut is inert while focus sits inside a form control —
 * the same restraint `DecisionPanel` and S10's own hook state for theirs.
 */
import { useEffect } from "react";

export interface InboxKeyboardHandlers {
  onMoveFocus: (direction: 1 | -1) => void;
  onOpenFocused: () => void;
  onToggleHelp: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** Exported for the unit test to drive directly, without faking a DOM event dispatch for every key. */
export function handleInboxKeydown(event: KeyboardEvent, handlers: InboxKeyboardHandlers): void {
  if (isTypingTarget(event.target)) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    handlers.onMoveFocus(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    handlers.onMoveFocus(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    handlers.onOpenFocused();
  } else if (event.key === "?") {
    event.preventDefault();
    handlers.onToggleHelp();
  }
}

export function useInboxKeyboard(handlers: InboxKeyboardHandlers, disabled = false): void {
  useEffect(() => {
    if (disabled) return;
    function onKeyDown(event: KeyboardEvent) {
      handleInboxKeydown(event, handlers);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, handlers]);
}
