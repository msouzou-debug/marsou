"use client";

// S04 — ADR-0029
//
/**
 * BudgetPositionPanel — eFinance's budget position for the budget codes this
 * project's contracts are charged to: one card per (budget code, year), with
 * the five numbers eFinance computes and the time they are as of.
 *
 * | Prop    | Type                      | Notes                                                              |
 * |---------|---------------------------|---------------------------------------------------------------------|
 * | data    | ProjectBudgetPosition?    | `GET /projects/:id/budget-position`. Ignored in `loading` \| `error`.  |
 * | state   | BudgetPositionState       | `default` \| `loading` \| `error` (a 502: eFinance was configured and did not answer). |
 * | onRetry | () => void?               | Wired to the error state's retry button.                             |
 *
 * RULE (INTEGRATION §5, ADR-0029): this is eFinance's view by budget code. It
 * is deliberately NOT folded into the project's four-ledger CostBar above it:
 * a budget code can carry other projects' contracts, eFinance's «Δεσμεύσεις»
 * are its own commitments (never eCapital's, ADR-0015), and «Σε εξέλιξη»
 * (in flight) is forecast only. The one-line caption says so, and the cards
 * are never summed across codes.
 *
 * RULE (ADR-0021 §7): a figure eFinance does not have is `null` and reads «—»,
 * never 0. «Σε εξέλιξη» is marked «Δεν προσμετράται» in text, not by colour.
 *
 * State: default, loading, error, plus the two quiet answers that are not
 * errors — not configured, and configured with no budget code to ask about.
 * No-permission and offline are the page's own (this panel only mounts inside
 * the S04 body, which already handled both).
 */
import { useTranslations } from "next-intl";
import type { BudgetPosition, ProjectBudgetPosition } from "@ecapital/shared";
import { formatDateTime, formatEURorDash } from "@/lib/format";

export type BudgetPositionState = "default" | "loading" | "error";

export interface BudgetPositionPanelProps {
  data?: ProjectBudgetPosition;
  state: BudgetPositionState;
  onRetry?: () => void;
}

function Figure({ label, value, note, testId }: { label: string; value: number | null; note?: string; testId: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-k-text">{label}</dt>
      <dd className="num text-fs-16 text-k-ink" data-testid={testId}>
        {value !== null && value < 0 ? <span className="text-k-red">{formatEURorDash(value)}</span> : formatEURorDash(value)}
      </dd>
      {note && <p className="text-fs-12 text-k-text">{note}</p>}
    </div>
  );
}

function PositionCard({ position }: { position: BudgetPosition }) {
  const t = useTranslations("screens.s04.efinance");
  return (
    <li className="rounded-k border border-k-grey bg-k-white p-s-4" data-testid="budget-position-row">
      <div className="flex flex-wrap items-baseline justify-between gap-s-2">
        <h3 className="text-fs-16 font-bold text-k-ink">
          <span className="text-fs-14 font-normal text-k-text">{t("budgetCode")} </span>
          <span className="num">{position.budgetCode}</span>
          <span className="text-fs-14 font-normal text-k-text"> · {t("year")} </span>
          <span className="num">{position.year}</span>
        </h3>
        {position.asOf && <p className="text-fs-12 text-k-text">{t("asOf", { when: formatDateTime(position.asOf) })}</p>}
      </div>
      <dl className="mt-s-3 grid grid-cols-2 gap-x-s-4 gap-y-s-3 text-fs-14 tablet:grid-cols-5">
        <Figure label={t("allocated")} value={position.allocated} testId="bp-allocated" />
        <Figure label={t("booked")} value={position.booked} testId="bp-booked" />
        <Figure label={t("requisitions")} value={position.requisitions} testId="bp-requisitions" />
        {/* RULE: in flight is shown and marked, never counted. */}
        <Figure label={t("inFlight")} value={position.inFlight} note={t("notCounted")} testId="bp-in-flight" />
        <Figure label={t("available")} value={position.available} testId="bp-available" />
      </dl>
    </li>
  );
}

export function BudgetPositionPanel({ data, state, onRetry }: BudgetPositionPanelProps) {
  const t = useTranslations("screens.s04.efinance");
  const tc = useTranslations("common");

  if (state === "loading") {
    return (
      <div aria-hidden="true" aria-busy="true" className="animate-pulse">
        <div className="h-4 w-[240px] rounded-k bg-k-grey" />
        <div className="mt-s-3 h-[88px] w-full rounded-k bg-k-grey" />
      </div>
    );
  }

  return (
    <section aria-labelledby="budget-position-title" className="grid gap-s-3">
      <div>
        <h2 id="budget-position-title" className="text-fs-16 font-bold text-k-ink">
          {t("title")}
        </h2>
        {/* RULE: the caption says why this is not in the CostBar above. */}
        <p className="text-fs-14 text-k-text">{t("caption")}</p>
      </div>

      {state === "error" ? (
        <div className="rounded-k border border-k-grey bg-k-white p-s-4">
          <p className="text-fs-14 text-k-ink">{t("error")}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-s-2 min-h-[44px] rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
              {tc("retry")}
            </button>
          )}
        </div>
      ) : !data || !data.configured ? (
        <p className="text-fs-14 text-k-text" data-testid="efinance-not-configured">
          {t("notConfigured")}
        </p>
      ) : data.items.length === 0 ? (
        <p className="text-fs-14 text-k-text">{t("empty")}</p>
      ) : (
        <ul className="grid gap-s-3">
          {data.items.map((position) => (
            <PositionCard key={`${position.budgetCode}-${position.year}`} position={position} />
          ))}
        </ul>
      )}
    </section>
  );
}
