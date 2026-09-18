"use client";

// S03 — R03, R04, R05, R07
//
/**
 * ProjectOverview — the pure S03 screen body (UI instructions §5 "S03 is a
 * two-column overview: left facts and Timeline, right CostBar and RagChips",
 * §6 states).
 *
 * Takes data the caller already fetched (`ProjectOverviewScreen` is the only
 * place that calls `useProjectDetail` — see S01's `Portfolio`/`PortfolioScreen`
 * pair for why the split exists) and a resolved `state`.
 *
 * | Prop         | Type                        | Notes                                                        |
 * |--------------|-----------------------------|-----------------------------------------------------------------|
 * | data         | ProjectDetail?              | Ignored in `noPermission` \| `loading` \| `error`; required otherwise. |
 * | state        | ProjectOverviewScreenState  | Which state to render. No `empty` — a detail page always names one project or none at all (never a filtered-down list), so "empty" does not apply (UI instructions §6, noted again in the preview). |
 * | onRetry      | () => void?                 | Wired to the error state's retry button.                        |
 * | noPermission | ReactNode                   | The shell's `NoPermission`. RULE: the API answers 404 for both "no such project" and "not yours" — this screen renders the same `noPermission` for that 404 either way, never distinguishing them (ADR-0010). |
 */

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ProjectDetail, Rag } from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { CostBar } from "@/components/cost-bar";
import { RagChip } from "@/components/rag-chip";
import { Timeline, type TimelineEntry } from "@/components/timeline";
import type { Locale } from "@/i18n/config";
import { FactsList } from "./FactsList";
import { IssuesCard } from "./IssuesCard";
import { MilestonesCard } from "./MilestonesCard";
import { RisksCard } from "./RisksCard";

export type ProjectOverviewScreenState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface ProjectOverviewProps {
  data?: ProjectDetail;
  state: ProjectOverviewScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  /** Injectable "now" for the overdue-milestone rule; defaults to the real
   *  clock. Exists so tests and the preview do not depend on the date they
   *  happen to run on. */
  today?: Date;
}

function ragChipValue(rag: Rag): "green" | "amber" | "red" {
  return rag.toLowerCase() as "green" | "amber" | "red";
}

const DISABLED_TABS = ["cost", "schedule", "risksIssues"] as const;

export function ProjectOverview({ data, state, onRetry, noPermission, today }: ProjectOverviewProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;

  if (state === "noPermission") return <>{noPermission}</>;

  const tabs = (
    <div role="tablist" aria-label={t("screens.s03.tabs.overview")} className="flex flex-wrap gap-s-2 border-b border-k-grey">
      <button
        type="button"
        role="tab"
        aria-selected="true"
        className="border-b-2 border-k-blue-deep px-s-3 py-s-2 text-fs-14 font-bold text-k-blue-deep"
      >
        {t("screens.s03.tabs.overview")}
      </button>
      {DISABLED_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected="false"
          disabled
          title={t("screens.s03.tabsDisabledTooltip")}
          className="px-s-3 py-s-2 text-fs-14 text-k-text disabled:opacity-50"
        >
          {t(`screens.s03.tabs.${tab}`)}
        </button>
      ))}
    </div>
  );

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

  const unitName = locale === "en" ? data.orgUnit.nameEn : data.orgUnit.nameEl;
  const timelineEntries: TimelineEntry[] = data.audit.map((entry) => ({
    id: entry.id,
    actor: entry.actorName,
    action: t(`screens.s03.audit.${entry.action}`),
    timestamp: entry.at,
    diff: entry.detail ?? undefined,
  }));

  return (
    <>
      <PageTitle eyebrow={`${data.code} · ${unitName}`} title={data.titleEl} tabs={tabs} />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <div className="grid grid-cols-1 gap-s-8 desktop:grid-cols-12">
        <div className="desktop:col-span-7">
          <FactsList project={data} />
          <div className="mt-s-6">
            <Timeline entries={timelineEntries} />
          </div>
        </div>

        <div className="grid gap-s-6 desktop:col-span-5">
          <div>
            <CostBar
              approved={data.ledgers.approved}
              committed={data.ledgers.committed}
              spent={data.ledgers.spent}
              forecast={data.ledgers.forecast}
            />
          </div>
          <div>
            <RagChip value={ragChipValue(data.rag)} />
            <p className="mt-s-2 text-fs-14 text-k-text">{data.ragReason}</p>
          </div>
          <MilestonesCard milestones={data.milestones} today={today} />
          <RisksCard risks={data.risks} />
          <IssuesCard issues={data.issues} />
        </div>
      </div>
    </>
  );
}
