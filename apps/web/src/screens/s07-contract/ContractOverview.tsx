"use client";

// S07 — R08, R10, R31
//
/**
 * ContractOverview — the pure S07 screen body (build brief §4 CostBar, §5
 * "S07–S09 are record pages with a Timeline" — S07 has no audit trail of its
 * own yet (M1 does not add one for contracts), so the record-page care this
 * brief asks for lands on the money facts instead: mono figures, retention
 * on its own line, an expired bond that is never colour alone).
 *
 * | Prop         | Type                          | Notes                                                        |
 * |--------------|-------------------------------|-------------------------------------------------------------------|
 * | data         | ContractDetail?               | Ignored in `noPermission` \| `loading` \| `error`; required otherwise. |
 * | state        | ContractOverviewScreenState   | Which of the four states to render — no `empty` (a detail page names one contract or none, same reasoning as S03's own `ProjectOverview`). |
 * | onRetry      | () => void?                   | Wired to the error state's retry button.                          |
 * | noPermission | ReactNode                     | The shell's `NoPermission`. RULE (ADR-0010): same 404 for "no such contract" and "not yours", never distinguished. |
 * | roles        | AppRole[]                     | The caller's own roles — the «Επεξεργασία» gate (`canWriteContracts`). |
 * | today        | Date?                         | Injectable "now" for the expired-bond rule; tests and the preview pass a fixed date. |
 * | onSaveBoq / boqSaving / boqError | — | `ContractOverviewScreen` owns the `PUT /contracts/:id/boq` call. |
 * | links        | ConfigLinks?                  | `GET /config/links` (ADR-0019 §4) — where eMAP and eFinance are, or null. Undefined while it loads; the link-outs simply do not appear. |
 *
 * RULE (build brief §5): the warnings strip is amber, one line per
 * `ContractWarning`, in the caller's own language (`sentenceEl`/`sentenceEn`
 * — the API authors both, CAPEX-01 §6.1's "never machine-translate"), and it
 * never disables anything below it — R31 is warn-and-flag, not a gate.
 */
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import type { AppRole, ConfigLinks, ContractDetail } from "@ecapital/shared";
import { TriangleAlert } from "lucide-react";
import { canWriteContracts } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { CostBar } from "@/components/cost-bar";
import type { Locale } from "@/i18n/config";
import { formatEUR, formatPct } from "@/lib/format";
import { BoqSection, type BoqDraftRow } from "./BoqSection";
import { ContractFacts } from "./ContractFacts";
import { ContractTabs } from "./ContractTabs";
import { LinkOuts } from "./LinkOuts";
import { VariationsList } from "./VariationsList";

export type ContractOverviewScreenState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface ContractOverviewProps {
  data?: ContractDetail;
  state: ContractOverviewScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  today?: Date;
  onSaveBoq?: (rows: BoqDraftRow[]) => void;
  boqSaving?: boolean;
  boqError?: string;
  links?: ConfigLinks;
}

// RULE (R31): variationPctOfOriginal over 10% is --k-red, per the build
// brief's own threshold for this warning.
const WARNING_PCT_THRESHOLD = 10;

export function ContractOverview({
  data,
  state,
  onRetry,
  noPermission,
  roles = [],
  today,
  onSaveBoq = () => undefined,
  boqSaving = false,
  boqError,
  links,
}: ContractOverviewProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;

  if (state === "noPermission") return <>{noPermission}</>;

  if (state === "loading") {
    return (
      <div aria-hidden="true" aria-busy="true" className="animate-pulse">
        <div className="mb-s-6">
          <div className="h-3 w-[160px] rounded-k bg-k-grey" />
          <div className="mt-s-2 h-6 w-[320px] rounded-k bg-k-grey" />
        </div>
        <div className="grid grid-cols-1 gap-s-6 desktop:grid-cols-12">
          <div className="grid gap-s-2 desktop:col-span-7">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="h-4 w-full rounded-k bg-k-grey" />
            ))}
          </div>
          <div className="grid gap-s-4 desktop:col-span-5">
            <div className="h-6 w-full rounded-k bg-k-grey" />
            <div className="h-[120px] w-full rounded-k bg-k-grey" />
          </div>
        </div>
      </div>
    );
  }

  if (state === "error" || !data) {
    return (
      <div className="rounded-k border border-k-grey bg-k-white p-s-8 text-center">
        <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
          >
            {t("common.retry")}
          </button>
        )}
      </div>
    );
  }

  const offline = state === "offline";
  const canEdit = canWriteContracts(roles);
  const overTen = data.variationPctOfOriginal > WARNING_PCT_THRESHOLD;
  const retentionAmount = (data.currentValue * data.retentionPct) / 100;

  return (
    <>
      {/* RULE (ADR-0019): the eCapital reference comes first — it is the
          string eFinance stores against an invoice and the one people read
          out over the telephone. The legal number off the tender papers
          keeps its place next to it; neither replaces the other. The eyebrow
          is already mono (`.eyebrow`, CONVENTIONS.md). */}
      <PageTitle
        eyebrow={
          <>
            <span className="num">{data.ref}</span>
            {` · ${data.contractNo} · ${data.project.code}`}
          </>
        }
        title={data.contractorName}
        tabs={
          <ContractTabs
            contractId={data.id}
            active="overview"
            rfisOpenCount={data.rfisOpen}
            defectsOpenCount={data.defects?.filter((d) => d.status !== "CLOSED").length}
          />
        }
        action={
          canEdit ? (
            offline ? (
              <span
                title={t("states.offline.readOnly")}
                aria-disabled="true"
                className="rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 font-bold text-k-text opacity-50"
              >
                {t("buttons.edit")}
              </span>
            ) : (
              <Link
                href={`/contracts/${encodeURIComponent(data.id)}/edit`}
                className="rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 font-bold text-k-blue-deep"
              >
                {t("buttons.edit")}
              </Link>
            )
          ) : undefined
        }
      />

      {/* ADR-0019 §4: only what this deployment was actually told about. */}
      <LinkOuts contract={data} links={links} />

      {offline && <p className="mb-s-4 mt-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {data.warnings.length > 0 && (
        <div className="mb-s-6 grid gap-s-2" role="status">
          {data.warnings.map((warning) => (
            <p
              key={warning.key}
              className="flex items-start gap-s-2 rounded-k border border-k-amber bg-k-amber-bg px-s-3 py-s-2 text-fs-14 text-k-ink"
            >
              <TriangleAlert size={20} strokeWidth={1.5} aria-hidden="true" className="mt-[2px] shrink-0 text-k-amber" />
              <span>{locale === "en" ? warning.sentenceEn : warning.sentenceEl}</span>
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-s-8 desktop:grid-cols-12">
        <div className="grid gap-s-6 desktop:col-span-7">
          <ContractFacts contract={data} today={today} />
          <BoqSection boq={data.boq} canEdit={canEdit && !offline} onSave={onSaveBoq} saving={boqSaving} apiError={boqError} />
        </div>

        <div className="grid gap-s-6 desktop:col-span-5">
          {/* Nit 1: S07's "approved"/"committed" ledgers are the original and
              current contract value, not the glossary's own words, so the
              legend labels are overridden rather than adding a second, mono
              line underneath repeating the same three figures. */}
          <CostBar
            approved={data.originalValue}
            committed={data.currentValue}
            spent={null}
            forecast={null}
            labels={{ approved: t("screens.s07.cost.originalValueLabel"), committed: t("screens.s07.cost.currentValueLabel") }}
          />

          <dl className="grid gap-s-2 text-fs-14">
            <div className="flex items-baseline justify-between gap-s-3">
              <dt className="text-k-text">{t("screens.s07.cost.approvedVariations")}</dt>
              <dd className="num">
                {/* RULE (R31): over 10% of the original value, --k-red — as
                    its own element so it stays queryable/testable on its own,
                    not as one text node shared with the percentage next to it. */}
                <span className={overTen ? "text-k-red" : "text-k-ink"}>{formatEUR(data.approvedVariationsTotal)}</span>{" "}
                <span className={overTen ? "text-k-red" : "text-k-text"}>
                  ({formatPct(data.variationPctOfOriginal)})
                </span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-s-3">
              <dt className="text-k-text">{t("screens.s07.cost.pendingVariations")}</dt>
              <dd className="num text-k-ink">{formatEUR(data.pendingVariationsTotal)}</dd>
            </div>
            {/* RULE (build brief §5): retention is its own line, never netted
                into the current value above it. */}
            <div className="flex items-baseline justify-between gap-s-3" data-testid="contract-retention-line">
              <dt className="text-k-text">
                {t("screens.s07.cost.retention")} ({formatPct(data.retentionPct)})
              </dt>
              <dd className="num text-k-ink">{formatEUR(retentionAmount)}</dd>
            </div>
          </dl>

          <VariationsList contractId={data.id} variations={data.variations} />
        </div>
      </div>
    </>
  );
}
