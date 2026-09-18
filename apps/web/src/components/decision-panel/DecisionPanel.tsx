"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export interface DecisionFact {
  label: string;
  value: string;
}

/**
 * DecisionPanel — 480px right sheet on desktop, full screen on phone
 * (UI instructions §4 DecisionPanel, used by S14 Εγκρίσεις).
 *
 * | Prop      | Type                    | Notes                                                |
 * |-----------|-------------------------|--------------------------------------------------------|
 * | what      | string                  | Header: what is being decided                           |
 * | where     | string                  | Header: unit / area context                             |
 * | facts     | DecisionFact[]          | Exactly three [{label, value}] — see RULE below         |
 * | onApprove | () => void              | `a` key or the primary button                           |
 * | onReturn  | (comment: string) => void | `r` key / secondary button, once a comment is typed   |
 * | onForward | () => void              | `f` key, optional (not every list has a "next")         |
 * | onClose   | () => void              | `x` key or the close button                             |
 * | loading   | boolean                 | Shows skeleton facts instead of the real ones           |
 *
 * RULE: never render the full record here (UI instructions §4) — only
 * `what`, `where` and the three facts are shown; there is no prop for
 * arbitrary extra content.
 *
 * RULE: exactly three facts. More or fewer is a caller bug, not a design
 * choice, so this throws in development rather than silently truncating.
 *
 * Keyboard: `a` approve, `r` reveal/submit the return comment, `f` forward,
 * `x` close. Shortcuts are ignored while focus is inside the comment
 * textarea so typing "a case" does not trigger Approve.
 *
 * NOTE (flagged, not guessed): this component does not check whether the
 * approver is the person who raised the item. That is an access-control
 * decision for the screen/API layer, not this panel — see hand-back summary.
 *
 * States: default, loading (skeleton facts). Empty/error/offline belong to
 * the approvals list (S14) that opens this panel, not to the panel itself;
 * no-permission means the panel is never opened at all.
 */
export interface DecisionPanelProps {
  what: string;
  where: string;
  facts: DecisionFact[];
  onApprove: () => void;
  onReturn: (comment: string) => void;
  onForward?: () => void;
  onClose: () => void;
  loading?: boolean;
}

export function DecisionPanel({
  what,
  where,
  facts,
  onApprove,
  onReturn,
  onForward,
  onClose,
  loading = false,
}: DecisionPanelProps) {
  const t = useTranslations();
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // RULE: exactly three facts (UI instructions §4). Guards against a caller
  // slipping in extra data — this panel is deliberately not the full record.
  if (!loading && process.env.NODE_ENV !== "production" && facts.length !== 3) {
    throw new Error(
      `DecisionPanel requires exactly three facts, received ${facts.length} (UI instructions §4).`,
    );
  }

  useEffect(() => {
    if (showComment) textareaRef.current?.focus();
  }, [showComment]);

  function revealOrSubmitReturn() {
    if (!showComment) {
      setShowComment(true);
      return;
    }
    if (comment.trim()) onReturn(comment);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";
      if (typing) return;
      if (e.key === "a") onApprove();
      else if (e.key === "r") revealOrSubmitReturn();
      else if (e.key === "f") onForward?.();
      else if (e.key === "x") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onApprove, onForward, onClose, showComment, comment]);

  const canSubmitReturn = comment.trim().length > 0;

  return (
    <div
      role="dialog"
      aria-label={what}
      className="fixed inset-0 desktop:inset-y-0 desktop:left-auto desktop:right-0 desktop:w-[480px] bg-k-white shadow-k flex flex-col"
    >
      <header className="flex items-start justify-between border-b border-k-grey p-s-5">
        <div>
          <h2 className="text-fs-20">{what}</h2>
          <p className="mt-s-1 text-fs-14 text-k-text">{where}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="rounded-k p-s-2 text-k-text hover:bg-k-surface"
        >
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-auto p-s-5">
        <dl className="grid gap-s-4">
          {loading
            ? [0, 1, 2].map((i) => (
                <div key={i} aria-hidden="true">
                  <div className="h-s-3 w-1/3 animate-pulse rounded-k-chip bg-k-grey" />
                  <div className="mt-s-2 h-s-4 w-2/3 animate-pulse rounded-k-chip bg-k-grey" />
                </div>
              ))
            : facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-fs-12 text-k-text-muted">{fact.label}</dt>
                  <dd className="text-fs-16 text-k-ink">{fact.value}</dd>
                </div>
              ))}
        </dl>
      </div>

      <footer className="border-t border-k-grey p-s-4">
        {showComment && (
          <div className="mb-s-3">
            <textarea
              ref={textareaRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("components.decision-panel.commentPlaceholder")}
              rows={3}
              className="w-full rounded-k border border-k-grey p-s-3 text-fs-14"
            />
            {!canSubmitReturn && (
              <p className="mt-s-1 text-fs-12 text-k-text-muted">
                {t("components.decision-panel.commentRequired")}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-col tablet:flex-row gap-s-3">
          <button
            type="button"
            onClick={onApprove}
            className="h-[56px] tablet:h-auto tablet:py-s-3 flex-1 rounded-k bg-k-blue text-fs-14 font-bold text-k-white shadow-k"
          >
            {t("buttons.approve")}
          </button>
          <button
            type="button"
            onClick={revealOrSubmitReturn}
            disabled={showComment && !canSubmitReturn}
            className="h-[56px] tablet:h-auto tablet:py-s-3 flex-1 rounded-k border border-k-grey text-fs-14 font-bold text-k-text disabled:text-k-text-muted disabled:cursor-not-allowed"
          >
            {t("buttons.returnWithComments")}
          </button>
        </div>
      </footer>
    </div>
  );
}
