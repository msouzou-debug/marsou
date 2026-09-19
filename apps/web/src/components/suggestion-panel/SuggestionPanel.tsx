"use client";

// S10 — R14
//
/**
 * SuggestionPanel — the right-hand 45% pane of S10's unmatched-transaction
 * queue (build brief §5 S10, §7 glossary), for the one row currently
 * focused in the left-hand table.
 *
 * The top suggestion (`suggestions[0]`) renders prominently with its
 * confidence as a sentence («Υψηλή αντιστοιχία — ίδιος κωδικός WBS», not a
 * bare percentage — the reason is text a person can act on). Every
 * suggestion, the top one included, also sits in a numbered shortlist —
 * `1`–`9` on the keyboard (`KeyboardHintBar`) picks the matching one; `Enter`
 * (handled by the caller, not here) accepts the top one.
 *
 * | Prop        | Type                       | Notes                                                       |
 * |-------------|----------------------------|---------------------------------------------------------------|
 * | suggestions | Suggestion[]               | Up to 9 (contract `UnmatchedRow.suggestions`), best match first. |
 * | onPick      | (index: number) => void    | 0-based; the caller's own `1`–`9` key handler and a click both call this. |
 * | pickingIndex| number?                    | Which suggestion is mid-`allocate` — disables the buttons while true. |
 *
 * State: default (has suggestions) and empty (none — the row needs a manual
 * search, which S10's own bulk-assign picker provides). Loading/error/
 * offline/noPermission are the queue screen's own states, not this panel's —
 * it only ever renders whatever the caller already fetched for the focused
 * row (same reasoning as `WarningStrip`'s header comment).
 */
import { useTranslations } from "next-intl";
import type { Suggestion } from "@ecapital/shared";

export interface SuggestionPanelProps {
  suggestions: Suggestion[];
  onPick: (index: number) => void;
  pickingIndex?: number;
}

export function SuggestionPanel({ suggestions, onPick, pickingIndex }: SuggestionPanelProps) {
  const t = useTranslations("components.suggestion-panel");

  if (suggestions.length === 0) {
    return (
      <div className="rounded-k border border-k-grey bg-k-white p-s-5 text-center">
        <p className="text-fs-14 text-k-text">{t("empty")}</p>
      </div>
    );
  }

  const top = suggestions[0]!;

  return (
    <div className="rounded-k border border-k-grey bg-k-white p-s-5">
      <p className="eyebrow">{t("topSuggestion")}</p>
      <p className="mt-s-2 text-fs-16 font-bold text-k-ink">
        {top.projectCode} · {top.projectTitleEl}
        {top.contractRef ? ` — ${top.contractRef}` : ""}
      </p>
      <p className="mt-s-1 text-fs-14 text-k-text">
        {t(`confidence.${top.confidence}`)} — {t(`reason.${top.reason}`)}
      </p>
      <p className="mt-s-2 text-fs-12 text-k-text-muted">{t("acceptHint")}</p>

      <p className="mt-s-5 eyebrow">{t("shortlist")}</p>
      <ol className="mt-s-2 grid gap-s-2">
        {suggestions.map((suggestion, index) => (
          <li key={`${suggestion.projectId}-${suggestion.contractId ?? "none"}-${index}`}>
            <button
              type="button"
              onClick={() => onPick(index)}
              disabled={pickingIndex !== undefined}
              className="flex w-full items-center gap-s-3 rounded-k border border-k-grey px-s-3 py-s-2 text-left text-fs-14 hover:border-k-blue-deep disabled:opacity-50"
            >
              <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-k-chip border border-k-grey text-fs-12 font-bold text-k-blue-deep">
                {index + 1}
              </span>
              <span className="flex-1">
                <span className="block text-k-ink">
                  {suggestion.projectCode} · {suggestion.projectTitleEl}
                </span>
                <span className="block text-fs-12 text-k-text">
                  {t(`confidence.${suggestion.confidence}`)} — {t(`reason.${suggestion.reason}`)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
