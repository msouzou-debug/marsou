"use client";

/**
 * SideSheet — the row-open sheet every list screen opens over its `Table`
 * (RFIs, instructions, defects, variations, risks, issues, users,
 * contractors, eFinance invoice lines).
 *
 * | Prop      | Type        | Notes                                                        |
 * |-----------|-------------|---------------------------------------------------------------|
 * | title     | string      | The heading, and the dialog's accessible name.                 |
 * | onClose   | () => void  | The way out: the button at the top, Escape and the backdrop.  |
 * | children  | ReactNode   | The body; it scrolls, the header does not.                     |
 * | focusClose| boolean?    | Move focus to «Πίσω στη λίστα» on open (keyboard-first sheets). |
 *
 * RULE (OWNER UAT 25/11/2026, «you have to go elsewhere in the menu and come
 * back»; «the fields date due and status remain in the view area»): the
 * sheet sits above the top bar (z-30) and the table's sticky header (z-10),
 * on its own backdrop, so nothing of the list shows through it and its way
 * out is never under the top bar. There are three ways out, all the same
 * `onClose`: the visible «Πίσω στη λίστα» button at the top, Escape, and a
 * click on the backdrop. Escape is left to a native modal `<dialog>` (a
 * `ConfirmDialog` opened from inside the sheet) while one is open, so it
 * closes that dialog and not the sheet under it.
 *
 * State: default only — it holds no data of its own.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

export interface SideSheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  focusClose?: boolean;
}

export function SideSheet({ title, onClose, children, focusClose = false }: SideSheetProps) {
  const t = useTranslations();
  const closeRef = useRef<HTMLButtonElement>(null);
  // The latest `onClose`, so the listener is added once and never calls a
  // stale one.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (focusClose) closeRef.current?.focus();
  }, [focusClose]);

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="side-sheet-backdrop"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-k-ink/20 print:hidden"
      />
      <div
        role="dialog"
        aria-label={title}
        className="fixed inset-0 z-40 flex flex-col bg-k-white shadow-k desktop:inset-y-0 desktop:left-auto desktop:right-0 desktop:w-[480px]"
      >
        <header className="flex items-start justify-between gap-s-3 border-b border-k-grey p-s-5">
          <h2 className="text-fs-20">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-11 shrink-0 items-center gap-s-1 rounded-k border border-k-grey px-s-3 text-fs-14 text-k-text hover:bg-k-surface"
          >
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
            {t("common.backToList")}
          </button>
        </header>
        <div className="flex-1 overflow-auto p-s-5">{children}</div>
      </div>
    </>
  );
}
