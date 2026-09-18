"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/**
 * ConfirmDialog — native `<dialog>` for destructive actions
 * (UI instructions §4 ConfirmDialog).
 *
 * | Prop             | Type       | Notes                                                     |
 * |------------------|------------|--------------------------------------------------------------|
 * | open             | boolean    | Controls showModal()/close()                                  |
 * | title            | string     | Phrased as a question by the caller                            |
 * | consequence      | string     | One sentence describing what will happen                       |
 * | destructiveLabel | string     | Label for the red destructive button                            |
 * | requireCode      | string?    | RULE: when set, the record's own code — see below               |
 * | onCancel         | () => void | `Ακύρωση` button                                                |
 * | onConfirm        | () => void | Destructive button, only reachable once the gate (below) passes |
 *
 * RULE: anything that deletes cost data must pass `requireCode`. When set, a
 * text field appears and the destructive button stays disabled until the
 * typed value equals `requireCode` exactly (case-sensitive, no trimming) —
 * the point is to make the user read and retype the real code, not to be
 * forgiving about whitespace.
 *
 * State: default only — this dialog has no data of its own to load; it is
 * either open or not.
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  consequence: string;
  destructiveLabel: string;
  requireCode?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  consequence,
  destructiveLabel,
  requireCode,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useTranslations();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [typedCode, setTypedCode] = useState("");

  // Reset the typed code the moment `open` flips to false, so a later
  // reopen never shows a stale value. Adjusted during render (React's
  // recommended pattern for resetting state on a prop change) rather than
  // in the effect below, which only needs to talk to the DOM `<dialog>`.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setTypedCode("");
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // jsdom (unit tests) has no <dialog> implementation at all — showModal
    // and close are simply missing, so fall back to toggling the `open`
    // attribute by hand there. Real browsers always have showModal/close.
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  // RULE: the destructive button only enables once the typed code matches
  // the record's code exactly (UI instructions §4, deletes-cost-data guard).
  const codeGateOpen = requireCode === undefined || typedCode === requireCode;

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="w-[min(90vw,420px)] rounded-k border-none p-s-6 shadow-k backdrop:bg-k-ink/60"
    >
      <h2 className="text-fs-20">{title}</h2>
      <p className="mt-s-3 text-fs-14 text-k-text">{consequence}</p>

      {requireCode !== undefined && (
        <div className="mt-s-4">
          <label htmlFor="confirm-dialog-code" className="text-fs-12 text-k-text-muted">
            {t("components.confirm-dialog.codeLabel", { code: requireCode })}
          </label>
          <input
            id="confirm-dialog-code"
            type="text"
            value={typedCode}
            onChange={(e) => setTypedCode(e.target.value)}
            placeholder={t("components.confirm-dialog.codePlaceholder")}
            className="num mt-s-1 w-full rounded-k border border-k-grey p-s-2 text-left"
          />
        </div>
      )}

      <div className="mt-s-5 flex justify-end gap-s-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-k px-s-5 py-s-3 text-fs-14 text-k-text"
        >
          {t("buttons.cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!codeGateOpen}
          className="rounded-k bg-k-red px-s-5 py-s-3 text-fs-14 font-bold text-k-white disabled:bg-k-grey disabled:text-k-text-muted"
        >
          {destructiveLabel}
        </button>
      </div>
    </dialog>
  );
}
