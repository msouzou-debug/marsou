"use client";

// S04 — R31
//
/**
 * WarningStrip — the amber warn-and-flag strip between the CostBar and the
 * cost table (UI instructions §5 S04, §6 states, brief §7 glossary).
 *
 * One line per live `CostWarning`, in the caller's own language
 * (`sentenceEl`/`sentenceEn` — the API authors both and always includes the
 * amount in the sentence itself, CAPEX-01 §6.1's "never machine-translate"),
 * with a quiet «Απόρριψη» link (RULE: not a `buttons.*` verb — the same
 * reasoning `VariationSheet`'s `RejectLink` documents — so it renders as a
 * link, never as a button from the fixed set).
 *
 * RULE (R31): dismissing is never a delete. Once `onDismiss` resolves, the
 * caller replaces that warning's own entry in `warnings` with the same
 * object carrying `dismissedByName`/`dismissedAt` — this component then
 * swaps that one line for a 12px «Απορρίφθηκε από {name}, {date time}» line
 * instead of removing it, so the strip still says a warning fired here, even
 * once it has been acknowledged. Warnings never disable saving anywhere
 * downstream — this strip holds no gate, only information and one link.
 *
 * | Prop         | Type                        | Notes                                                    |
 * |--------------|-----------------------------|-----------------------------------------------------------|
 * | warnings     | CostWarning[]               | Already resolved by the caller; empty renders nothing at all. |
 * | canDismiss   | boolean                     | `canDismissCostWarning(roles)` — hides the link, not the sentence, for a caller who may not act. |
 * | dismissingId | string?                     | The warning currently being dismissed — disables just that link. |
 * | onDismiss    | (warningId: string) => void |                                                             |
 *
 * State: default only. `warnings` is already the caller's own resolved data
 * (the same reasoning `CostBar`'s header comment gives) — there is nothing
 * for this component itself to load, fail or go offline on; the parent
 * screen's own loading/error/offline states cover the strip along with the
 * rest of the page. No-permission never applies: a caller who cannot see
 * S04 at all never reaches a warning to render.
 */
import { useLocale, useTranslations } from "next-intl";
import type { CostWarning } from "@ecapital/shared";
import type { Locale } from "@/i18n/config";
import { formatDateTime } from "@/lib/format";

export interface WarningStripProps {
  warnings: CostWarning[];
  canDismiss?: boolean;
  dismissingId?: string;
  onDismiss: (warningId: string) => void;
}

export function WarningStrip({ warnings, canDismiss = true, dismissingId, onDismiss }: WarningStripProps) {
  const t = useTranslations("components.warning-strip");
  const locale = useLocale() as Locale;

  if (warnings.length === 0) return null;

  return (
    <div className="rounded-k border border-k-amber bg-k-amber-bg p-s-4" role="region" aria-label={t("label")}>
      <ul className="grid gap-s-2">
        {warnings.map((warning) => {
          const dismissed = Boolean(warning.dismissedByName);
          const sentence = locale === "en" ? warning.sentenceEn : warning.sentenceEl;
          return (
            <li key={warning.id} className="flex flex-wrap items-center justify-between gap-s-3">
              {dismissed ? (
                // RULE: the dismissed line is 12px, not the strip's own 14px
                // sentence — it reads as a quieter, settled fact.
                <p className="text-fs-12 text-k-text">
                  {t("dismissedBy", {
                    name: warning.dismissedByName ?? "",
                    when: warning.dismissedAt ? formatDateTime(warning.dismissedAt) : "",
                  })}
                </p>
              ) : (
                <>
                  <p className="text-fs-14 text-k-ink">{sentence}</p>
                  {canDismiss && (
                    <button
                      type="button"
                      onClick={() => onDismiss(warning.id)}
                      disabled={dismissingId === warning.id}
                      className="shrink-0 text-fs-12 text-k-text underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      {t("dismiss")}
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
