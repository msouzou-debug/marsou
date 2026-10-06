"use client";

// S18a, S19 — R33, R34 (ADR-0031 §3, §6)
//
/**
 * TransitionDialog — the confirmation for one work-order action, built on
 * the platform `<dialog>` the way `ConfirmDialog` is. `ConfirmDialog` only
 * carries a title and one sentence (and a red button, for deletes); these
 * actions need an optional note, a reason for a cancel and a small form for
 * completion, so they get their own sheet with the same shape.
 *
 * | Prop        | Type                                        | Notes                                                    |
 * |-------------|---------------------------------------------|----------------------------------------------------------|
 * | open        | boolean                                     |                                                          |
 * | action      | WorkOrderAction \| null                     | Which button opened it.                                  |
 * | kind        | WorkOrderKind                               | A corrective COMPLETE needs the three codes.             |
 * | workRef     | string                                      | The order's ref, in the title.                           |
 * | defaults    | Partial codes/cost                          | What the order already carries (codes set in the edit panel). |
 * | submitting  | boolean                                     |                                                          |
 * | error       | string?                                     | The API's own sentence.                                  |
 * | phone       | boolean?                                    | S19: full-width sheet, 64px buttons, and only the note and the codes (UI instructions §5 S19: «a one-field note»). |
 * | onCancel    | () => void                                  |                                                          |
 * | onConfirm   | (body: WorkOrderTransition) => void         |                                                          |
 *
 * RULE (ADR-0031 §6): COMPLETE on a corrective order stays disabled until
 * the failure, cause and remedy codes are all picked.
 * RULE (contract `WorkOrderStatus`): CANCEL needs a reason; it rides as the
 * transition's note.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { CauseCode, FailureCode, RemedyCode, WorkOrderAction, WorkOrderKind, WorkOrderTransition } from "@ecapital/shared";
import { localInputToIsoInstant } from "@/lib/datetime";
import { CAUSE_CODES, codesComplete, dateInputToIso, FAILURE_CODES, needsCodes, REMEDY_CODES, type CompleteCodes } from "./actions";

export interface TransitionDialogProps {
  open: boolean;
  action: WorkOrderAction | null;
  kind: WorkOrderKind;
  workRef: string;
  defaults?: { failureCode?: FailureCode | null; causeCode?: CauseCode | null; remedyCode?: RemedyCode | null; costActual?: number | null };
  submitting: boolean;
  error?: string;
  phone?: boolean;
  onCancel: () => void;
  onConfirm: (body: WorkOrderTransition) => void;
}

const inputClass = "min-h-[44px] w-full rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink";

export function TransitionDialog(props: TransitionDialogProps) {
  const { open, action, kind, workRef, defaults, submitting, error, phone = false, onCancel, onConfirm } = props;
  const t = useTranslations();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [at, setAt] = useState("");
  const [codes, setCodes] = useState<CompleteCodes>({ failureCode: "", causeCode: "", remedyCode: "" });
  const [cost, setCost] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [touched, setTouched] = useState(false);

  // Reset the form each time the dialog opens, from what the order already
  // carries — adjusted during render, the pattern `ConfirmDialog` uses.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNote("");
      setAt("");
      setCodes({ failureCode: defaults?.failureCode ?? "", causeCode: defaults?.causeCode ?? "", remedyCode: defaults?.remedyCode ?? "" });
      setCost(defaults?.costActual != null ? String(defaults.costActual) : "");
      setReportDate("");
      setTouched(false);
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // jsdom has no <dialog> methods; fall back to the attribute (ConfirmDialog does the same).
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  const isComplete = action === "COMPLETE";
  const isCancel = action === "CANCEL";
  const codesNeeded = isComplete && needsCodes(kind);
  const costValue = cost.trim() === "" ? undefined : Number(cost.replace(",", "."));
  const costInvalid = costValue !== undefined && (Number.isNaN(costValue) || costValue < 0);
  const reasonMissing = isCancel && note.trim().length === 0;
  const codesMissing = codesNeeded && !codesComplete(codes);
  const blocked = reasonMissing || codesMissing || costInvalid;

  function submit() {
    setTouched(true);
    if (!action || blocked) return;
    const body: WorkOrderTransition = { action };
    if (at) body.at = localInputToIsoInstant(at);
    if (note.trim()) body.noteEl = note.trim();
    if (isComplete) {
      if (codes.failureCode) body.failureCode = codes.failureCode;
      if (codes.causeCode) body.causeCode = codes.causeCode;
      if (codes.remedyCode) body.remedyCode = codes.remedyCode;
      if (costValue !== undefined) body.costActual = costValue;
      if (reportDate) body.reportReceivedAt = dateInputToIso(reportDate);
    }
    onConfirm(body);
  }

  const buttonHeight = phone ? "min-h-[64px]" : "min-h-[44px]";

  return (
    <dialog
      ref={dialogRef}
      onClose={onCancel}
      aria-labelledby="wo-transition-title"
      className={`${phone ? "w-full max-w-none" : "w-[min(92vw,520px)]"} rounded-k border-none p-s-5 shadow-k backdrop:bg-k-ink/60`}
    >
      {action && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="grid gap-s-4"
        >
          <h2 id="wo-transition-title" className="text-fs-20">
            {t("screens.s18detail.dialog.title", { action: t(`workOrderAction.${action}`), ref: workRef })}
          </h2>
          <p className="text-fs-14 text-k-text">{t(`screens.s18detail.dialog.consequence.${action}`)}</p>

          {codesNeeded && (
            <fieldset className="grid gap-s-3">
              <legend className="mb-s-1 text-fs-14 font-bold text-k-blue-deep">{t("screens.s18detail.codes.title")}</legend>
              <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                {t("screens.s18detail.codes.failure")}
                <select value={codes.failureCode} onChange={(e) => setCodes({ ...codes, failureCode: e.target.value as FailureCode | "" })} className={inputClass}>
                  <option value="">{t("screens.s18detail.codes.pick")}</option>
                  {FAILURE_CODES.map((c) => (
                    <option key={c} value={c}>
                      {t(`failureCode.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                {t("screens.s18detail.codes.cause")}
                <select value={codes.causeCode} onChange={(e) => setCodes({ ...codes, causeCode: e.target.value as CauseCode | "" })} className={inputClass}>
                  <option value="">{t("screens.s18detail.codes.pick")}</option>
                  {CAUSE_CODES.map((c) => (
                    <option key={c} value={c}>
                      {t(`causeCode.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                {t("screens.s18detail.codes.remedy")}
                <select value={codes.remedyCode} onChange={(e) => setCodes({ ...codes, remedyCode: e.target.value as RemedyCode | "" })} className={inputClass}>
                  <option value="">{t("screens.s18detail.codes.pick")}</option>
                  {REMEDY_CODES.map((c) => (
                    <option key={c} value={c}>
                      {t(`remedyCode.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
              {touched && codesMissing && (
                <p role="alert" className="text-fs-14 text-k-red">
                  {t("screens.s18detail.codes.required")}
                </p>
              )}
            </fieldset>
          )}

          {isComplete && !phone && (
            <div className="grid grid-cols-1 gap-s-3 tablet:grid-cols-2">
              <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                {t("screens.s18detail.fields.costActual")}
                <input type="text" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className={`num ${inputClass}`} />
              </label>
              <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
                {t("screens.s18detail.dialog.reportReceived")}
                <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className={`num ${inputClass}`} />
              </label>
              {touched && costInvalid && (
                <p role="alert" className="text-fs-14 text-k-red tablet:col-span-2">
                  {t("screens.s18detail.fields.costInvalid")}
                </p>
              )}
            </div>
          )}

          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {isCancel ? t("screens.s18detail.dialog.reason") : t("screens.s18detail.dialog.note")}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full rounded-k border border-k-grey p-s-3 text-fs-16 text-k-ink" />
          </label>
          {touched && reasonMissing && (
            <p role="alert" className="text-fs-14 text-k-red">
              {t("screens.s18detail.dialog.reasonRequired")}
            </p>
          )}

          {!phone && (
          <div className="grid gap-s-1">
            <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
              {t("screens.s18detail.dialog.at")}
              <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-describedby="wo-transition-at-hint" className={`num ${inputClass}`} />
            </label>
            <p id="wo-transition-at-hint" className="text-fs-14 text-k-text">
              {t("screens.s18detail.dialog.atHint")}
            </p>
          </div>
          )}

          {error && (
            <p role="alert" className="text-fs-14 text-k-red">
              {error}
            </p>
          )}

          <div className={`flex gap-s-3 ${phone ? "flex-col-reverse" : "justify-end"}`}>
            <button type="button" onClick={onCancel} className={`${buttonHeight} rounded-k px-s-5 text-fs-16 text-k-text`}>
              {t("buttons.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting || (touched && blocked) || (codesMissing && isComplete)}
              className={`${buttonHeight} rounded-k bg-k-blue px-s-5 text-fs-16 font-bold text-k-white shadow-k disabled:bg-k-grey disabled:text-k-text-muted`}
            >
              {submitting ? t("screens.s18detail.saving") : t(`workOrderAction.${action}`)}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
