"use client";

// S03 — R04
//
/**
 * PhaseDialog — «Αλλαγή φάσης» (UI instructions §4 ConfirmDialog: same
 * native `<dialog>` shell and Ακύρωση/destructive-style button pair, but
 * built here rather than reused, because a phase change needs a field
 * `ConfirmDialog` has no prop for — a required reason textarea, and, for an
 * administrator, a choice of *which* phase to move to — not the single
 * yes/no `ConfirmDialog` is for).
 *
 * | Prop        | Type                              | Notes                                                              |
 * |-------------|-----------------------------------|--------------------------------------------------------------------------|
 * | open        | boolean                           | Controls showModal()/close(), same as `ConfirmDialog`.                     |
 * | currentPhase| ProjectPhase                      |                                                                            |
 * | isAdmin     | boolean                           | RULE (R04): only an admin may move a project backwards, and only one step. |
 * | submitting  | boolean                           | Disables the form; `Υποβολή` shows the spinner.                            |
 * | apiError    | { message; gateMilestoneId? }?    | RULE (R04): `errors.gateOpen` names the open gate; when the milestone's id is known (the current phase's own open gate, from `MilestonesCard`'s data) the message carries a link to its card via `#milestone-<id>`. Any other failure (`errors.phaseNotNext`, a read-only role) shows the message with no link. |
 * | onCancel    | () => void                        |                                                                            |
 * | onSubmit    | (phase: ProjectPhase, reasonEl: string) => void | Fired once the reason is non-empty.                          |
 *
 * RULE (R04): "a project moves exactly one step forward … or an
 * administrator may move it backwards" — so this dialog only ever offers
 * the immediately next phase, plus, for an admin only, the immediately
 * previous one. It never offers a phase two steps away in either direction;
 * that is `errors.phaseNotNext`'s job to refuse, not this dialog's to avoid
 * asking for in the first place beyond the one extra option R04 names.
 *
 * States: default only, same as `ConfirmDialog` — this dialog holds no data
 * of its own to load; "submitting" and the `apiError` prop are the caller's
 * request in flight, not a state the dialog resolves itself.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { ProjectPhase } from "@ecapital/shared";

export interface PhaseDialogApiError {
  message: string;
  /** The current phase's own open gate milestone, when the failure is
   *  `errors.gateOpen` and the screen could find it in the milestones
   *  already on the page — used to link straight to its card. */
  gateMilestoneId?: string;
}

export interface PhaseDialogProps {
  open: boolean;
  currentPhase: ProjectPhase;
  isAdmin: boolean;
  submitting: boolean;
  apiError?: PhaseDialogApiError;
  onCancel: () => void;
  onSubmit: (phase: ProjectPhase, reasonEl: string) => void;
}

function phaseAt(offset: number, from: ProjectPhase): ProjectPhase | null {
  const index = ProjectPhase.options.indexOf(from) + offset;
  return index >= 0 && index < ProjectPhase.options.length ? ProjectPhase.options[index] : null;
}

/**
 * Whether there is any phase move to offer at all — the next one, or, for an
 * admin, the previous one (R04). `ProjectOverview` calls this to decide
 * whether to show the «Αλλαγή φάσης» button in the first place: showing a
 * button that opens a dialog with nothing to submit (a CLOSED project, for
 * anyone who is not an admin) is worse than not showing it.
 */
export function canOfferPhaseChange(currentPhase: ProjectPhase, isAdmin: boolean): boolean {
  return phaseAt(1, currentPhase) !== null || (isAdmin && phaseAt(-1, currentPhase) !== null);
}

export function PhaseDialog({ open, currentPhase, isAdmin, submitting, apiError, onCancel, onSubmit }: PhaseDialogProps) {
  const t = useTranslations();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const nextPhase = phaseAt(1, currentPhase);
  const previousPhase = phaseAt(-1, currentPhase);
  const canGoBack = isAdmin && previousPhase !== null;
  // Default to whichever direction is actually offered — a project at
  // CLOSED has no next phase, so an admin's default (and only, unless they
  // pick otherwise) choice there is "previous", not a dead "next".
  const [direction, setDirection] = useState<"next" | "previous">(nextPhase !== null ? "next" : "previous");
  const [reasonEl, setReasonEl] = useState("");
  const [touched, setTouched] = useState(false);
  const targetPhase = direction === "previous" && canGoBack ? previousPhase : nextPhase;

  // Reset every draft the moment the dialog closes, so a later reopen never
  // shows a stale reason or a stale direction choice — same pattern as
  // `ConfirmDialog`'s own `wasOpen` reset.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setDirection(nextPhase !== null ? "next" : "previous");
      setReasonEl("");
      setTouched(false);
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // jsdom (unit tests) has no <dialog> implementation — see ConfirmDialog.
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  if (!targetPhase) return null; // CLOSED has no next phase; the caller hides the button itself.

  const reasonMissing = touched && reasonEl.trim() === "";

  function submit() {
    setTouched(true);
    if (reasonEl.trim() === "" || !targetPhase) return;
    onSubmit(targetPhase, reasonEl.trim());
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      className="w-[min(90vw,480px)] rounded-k border-none p-s-6 shadow-k backdrop:bg-k-ink/60"
    >
      <h2 className="text-fs-20">{t("screens.s03.phaseDialog.title")}</h2>

      {canGoBack ? (
        <fieldset className="mt-s-4 flex flex-col gap-s-2 border-0 p-0">
          <legend className="text-fs-14 text-k-text">{t("screens.s03.phaseDialog.directionLabel")}</legend>
          <label className="flex items-center gap-s-2 text-fs-14 text-k-ink">
            <input
              type="radio"
              name="phase-direction"
              value="next"
              checked={direction === "next"}
              onChange={() => setDirection("next")}
            />
            {t("screens.s03.phaseDialog.moveTo", { phase: t(`phases.${nextPhase}`) })}
          </label>
          <label className="flex items-center gap-s-2 text-fs-14 text-k-ink">
            <input
              type="radio"
              name="phase-direction"
              value="previous"
              checked={direction === "previous"}
              onChange={() => setDirection("previous")}
            />
            {t("screens.s03.phaseDialog.previousPhaseOption", { phase: t(`phases.${previousPhase}`) })}
          </label>
        </fieldset>
      ) : (
        <p className="mt-s-3 text-fs-16 text-k-ink">
          {t(`phases.${currentPhase}`)}
          {" → "}
          {t(`phases.${nextPhase}`)}
        </p>
      )}

      <div className="mt-s-4 flex flex-col gap-s-1">
        <label htmlFor="phase-dialog-reason" className="text-fs-14 text-k-text">
          {t("screens.s03.phaseDialog.reasonLabel")}
        </label>
        <textarea
          id="phase-dialog-reason"
          value={reasonEl}
          onChange={(event) => setReasonEl(event.target.value)}
          rows={4}
          aria-invalid={reasonMissing ? "true" : undefined}
          aria-describedby={reasonMissing ? "phase-dialog-reason-error" : undefined}
          className="w-full rounded-k border border-k-grey p-s-3 text-fs-14"
        />
        {reasonMissing && (
          <p id="phase-dialog-reason-error" role="alert" className="text-fs-14 text-k-red">
            {t("forms.required")}
          </p>
        )}
      </div>

      {apiError && (
        <p role="alert" className="mt-s-3 text-fs-14 text-k-red">
          {apiError.message}
          {apiError.gateMilestoneId && (
            <>
              {" "}
              <a href={`#milestone-${apiError.gateMilestoneId}`} className="underline underline-offset-2">
                {t("screens.s03.phaseDialog.gateLinkLabel")}
              </a>
            </>
          )}
        </p>
      )}

      <div className="mt-s-5 flex justify-end gap-s-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-k px-s-5 py-s-3 text-fs-14 text-k-text disabled:opacity-60"
        >
          {t("buttons.cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="flex items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 py-s-3 text-fs-14 font-bold text-k-white disabled:bg-k-grey disabled:text-k-text-muted"
        >
          {submitting && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
          {t("buttons.submit")}
        </button>
      </div>
    </dialog>
  );
}
