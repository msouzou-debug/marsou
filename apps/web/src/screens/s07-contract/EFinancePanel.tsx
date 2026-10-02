"use client";

// S07 — ADR-0029
//
/**
 * EFinancePanel — the eFinance block in the contract overview: whether and
 * when the contract reached eFinance, the four figures eFinance holds for it,
 * and, for an administrator, the button that sends it again.
 *
 * | Prop       | Type                                  | Notes                                                              |
 * |------------|---------------------------------------|---------------------------------------------------------------------|
 * | efinance   | EFinanceContractSummary \| null?      | `ContractDetail.efinance`. Null (or absent, on a fixture that predates it) is "not configured": one quiet line, no panel. |
 * | canPush    | boolean                               | `isAdmin(roles)` — the API's own `@Roles("admin")` on the push route. Hidden, not disabled, for anyone else. |
 * | offline    | boolean                               | Disables the button, with the reason.                                |
 * | pushing    | boolean                               | A push is in flight.                                                 |
 * | pushResult | EFinancePushResult?                   | The inline answer to the last push: success, or the error text.       |
 * | onPush     | () => void                            | `POST /contracts/:id/efinance/push`.                                  |
 *
 * RULE (ADR-0021 §7): every figure is `null` when eFinance has none, and
 * null reads «—», never 0. RULE (record §3, INTEGRATION §5): «Σε εξέλιξη»
 * (in flight) is forecast only. It is shown, marked «Δεν προσμετράται», and
 * is never part of «Δαπάνες» or «Υπόλοιπο». «Δεσμεύσεις eFinance» are
 * eFinance's own commitments and are not added to eCapital's «Δεσμεύσεις»
 * (ADR-0015).
 *
 * RULE (UI instructions §4): the push button is secondary. The one filled
 * blue button on this view is whatever the page's own action is, not this.
 *
 * State: default only. The panel is part of the contract detail the page
 * already loaded; its loading, error and offline states are the page's.
 */
import { useTranslations } from "next-intl";
import { LoaderCircle, Send } from "lucide-react";
import type { EFinanceContractSummary } from "@ecapital/shared";
import { formatDateTime, formatEURorDash } from "@/lib/format";

export type EFinancePushResult = { ok: true } | { ok: false; message: string };

export interface EFinancePanelProps {
  efinance: EFinanceContractSummary | null | undefined;
  canPush?: boolean;
  offline?: boolean;
  pushing?: boolean;
  pushResult?: EFinancePushResult;
  onPush?: () => void;
}

/** RULE (ADR-0029): the API stores a refusal as `CONFLICT: <eFinance's own words>`. */
export function isConflictError(lastError: string | null): boolean {
  return lastError !== null && /^CONFLICT/i.test(lastError.trim());
}

function conflictDetail(lastError: string): string {
  return lastError.trim().replace(/^CONFLICT:?\s*/i, "");
}

export function EFinancePanel({ efinance, canPush = false, offline = false, pushing = false, pushResult, onPush }: EFinancePanelProps) {
  const t = useTranslations("screens.s07.efinance");

  if (!efinance) {
    return (
      <p className="text-fs-14 text-k-text" data-testid="efinance-not-configured">
        {t("notConfigured")}
      </p>
    );
  }

  const conflict = isConflictError(efinance.lastError);
  const detail = efinance.lastError ? conflictDetail(efinance.lastError) : "";

  const figures: Array<{ key: string; label: string; value: number | null; note?: string; testId: string }> = [
    { key: "booked", label: t("figures.booked"), value: efinance.booked, testId: "efinance-booked" },
    // RULE: visibly marked as not counted — the note is text, not colour.
    { key: "inFlight", label: t("figures.inFlight"), value: efinance.inFlight, note: t("figures.notCounted"), testId: "efinance-in-flight" },
    { key: "requisitions", label: t("figures.requisitions"), value: efinance.requisitions, testId: "efinance-requisitions" },
    { key: "remaining", label: t("figures.remaining"), value: efinance.remaining, testId: "efinance-remaining" },
  ];

  return (
    <section aria-labelledby="efinance-panel-title" className="grid gap-s-3 rounded-k border border-k-grey bg-k-white p-s-4">
      <div className="flex flex-wrap items-baseline justify-between gap-s-2">
        <h2 id="efinance-panel-title" className="text-fs-16 font-bold text-k-ink">
          {t("title")}
        </h2>
        {efinance.lastSyncAt && (
          <p className="text-fs-12 text-k-text">{t("asOf", { when: formatDateTime(efinance.lastSyncAt) })}</p>
        )}
      </div>

      <div className="grid gap-s-1 text-fs-14" data-testid="efinance-push-state">
        {efinance.lastError ? (
          <>
            <p className="font-bold text-k-red">{conflict ? t("conflict") : t("lastError", { detail })}</p>
            {conflict && (
              <>
                <p className="text-k-text">{t("conflictHint")}</p>
                {detail && <p className="text-fs-12 text-k-text">{detail}</p>}
              </>
            )}
            {efinance.pushedAt && (
              <p className="text-k-text">{t("lastSuccess", { when: formatDateTime(efinance.pushedAt) })}</p>
            )}
          </>
        ) : efinance.pushedAt ? (
          <p className="text-k-ink">{t("sent", { when: formatDateTime(efinance.pushedAt) })}</p>
        ) : (
          <p className="text-k-text">{t("notSent")}</p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-s-4 gap-y-s-3 text-fs-14">
        {figures.map((figure) => (
          <div key={figure.key} className="min-w-0">
            <dt className="text-k-text">{figure.label}</dt>
            <dd className="num text-fs-16 text-k-ink" data-testid={figure.testId}>
              {figure.key === "remaining" && figure.value !== null && figure.value < 0 ? (
                <span className="text-k-red">{formatEURorDash(figure.value)}</span>
              ) : (
                formatEURorDash(figure.value)
              )}
            </dd>
            {figure.note && <p className="text-fs-12 text-k-text">{figure.note}</p>}
          </div>
        ))}
      </dl>

      {canPush && (
        <div className="grid gap-s-2">
          <div>
            <button
              type="button"
              onClick={onPush}
              disabled={pushing || offline}
              title={offline ? t("offlineReason") : undefined}
              className="flex min-h-[44px] items-center gap-s-2 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 font-bold text-k-blue-deep disabled:opacity-50"
            >
              {pushing ? (
                <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />
              ) : (
                <Send size={20} strokeWidth={1.5} aria-hidden="true" />
              )}
              {t("push")}
            </button>
          </div>
          {pushResult && (
            <p
              role={pushResult.ok ? "status" : "alert"}
              className={`text-fs-14 ${pushResult.ok ? "text-k-ink" : "text-k-red"}`}
              data-testid="efinance-push-result"
            >
              {pushResult.ok
                ? t("pushOk")
                : isConflictError(pushResult.message)
                  ? `${t("conflict")}. ${t("conflictHint")}`
                  : pushResult.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
