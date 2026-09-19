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
 * | roles        | AppRole[]                   | The caller's own roles (`me.roles`), for the write controls below. |
 * | phaseDialog* / onSubmitPhaseChange / onOpenPhaseDialog / onClosePhaseDialog | — | `ProjectOverviewScreen` owns the `POST /projects/:id/phase` call and the dialog's open/submitting/error state — same Screen/pure split as the network fetch itself. |
 *
 * RULE (`@/auth/roles`): the «Επεξεργασία» link (PageTitle's action slot)
 * is hidden for `auditor_readonly`/`executive_readonly` — both are
 * read-only at the row-policy level (ADR-0010), so the link would only ever
 * come back 403. The «Αλλαγή φάσης» button (next to the Φάση fact) is
 * additionally hidden for `clinical_approver` and `finance` — a
 * segregation call this build makes rather than one ADR-0014 states in so
 * many words; see the hand-back summary. Neither hides the *field*, only
 * the control: read access to the project itself is unaffected.
 */

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import type { AppRole, Contract, ProjectDetail, ProjectPhase, Rag } from "@ecapital/shared";
import { canChangeProjectPhase, canWriteProjects, isAdmin } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { CostBar } from "@/components/cost-bar";
import { RagChip } from "@/components/rag-chip";
import { Timeline, type TimelineEntry } from "@/components/timeline";
import type { Locale } from "@/i18n/config";
import type { PermitListRow } from "@ecapital/shared";
import { ContractsCard } from "./ContractsCard";
import { FactsList } from "./FactsList";
import { IssuesCard } from "./IssuesCard";
import { MilestonesCard } from "./MilestonesCard";
import { OpenPermitsCard } from "./OpenPermitsCard";
import { canOfferPhaseChange, PhaseDialog, type PhaseDialogApiError } from "./PhaseDialog";
import { ProjectTabs } from "./ProjectTabs";
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
  /** Defaults to `[]` — no write role — so every existing caller (tests,
   *  the "noPermission"/"error"/"loading" preview stories) that has no
   *  reason to care about the edit link or the phase dialog does not have
   *  to pass one. */
  roles?: AppRole[];
  phaseDialogOpen?: boolean;
  onOpenPhaseDialog?: () => void;
  onClosePhaseDialog?: () => void;
  onSubmitPhaseChange?: (phase: ProjectPhase, reasonEl: string) => void;
  phaseSubmitting?: boolean;
  phaseApiError?: PhaseDialogApiError;
  /** «Συμβάσεις» card — `ProjectOverviewScreen`'s own `useProjectContracts`
   *  query, passed through as plain props (see `ContractsCard`'s header
   *  comment for why it is not a query hook this component calls itself). */
  contracts?: Contract[];
  contractsLoading?: boolean;
  contractsError?: boolean;
  /** «Ανοικτές άδειες» card (item 9, M3) — same reasoning as `contracts` above: a permit has a life of its own once it exists (M3, R19–R25), so this is an extra query the Screen makes and an extra prop this card takes. */
  openPermits?: PermitListRow[];
  openPermitsLoading?: boolean;
  openPermitsError?: boolean;
}

function ragChipValue(rag: Rag): "green" | "amber" | "red" {
  return rag.toLowerCase() as "green" | "amber" | "red";
}

export function ProjectOverview({
  data,
  state,
  onRetry,
  noPermission,
  today,
  roles = [],
  phaseDialogOpen = false,
  onOpenPhaseDialog = () => undefined,
  onClosePhaseDialog = () => undefined,
  onSubmitPhaseChange = () => undefined,
  phaseSubmitting = false,
  phaseApiError,
  contracts,
  contractsLoading = false,
  contractsError = false,
  openPermits,
  openPermitsLoading = false,
  openPermitsError = false,
}: ProjectOverviewProps) {
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

  const unitName = locale === "en" ? data.orgUnit.nameEn : data.orgUnit.nameEl;
  const timelineEntries: TimelineEntry[] = data.audit.map((entry) => ({
    id: entry.id,
    actor: entry.actorName,
    action: t(`screens.s03.audit.${entry.action}`),
    timestamp: entry.at,
    diff: entry.detail ?? undefined,
  }));

  const offline = state === "offline";
  const canEdit = canWriteProjects(roles);
  const canChangePhase = canChangeProjectPhase(roles) && canOfferPhaseChange(data.phase, isAdmin(roles));

  return (
    <>
      <PageTitle
        eyebrow={`${data.code} · ${unitName}`}
        title={data.titleEl}
        tabs={<ProjectTabs projectId={data.id} active="overview" />}
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
                href={`/projects/${encodeURIComponent(data.id)}/edit`}
                className="rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 font-bold text-k-blue-deep"
              >
                {t("buttons.edit")}
              </Link>
            )
          ) : undefined
        }
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <div className="grid grid-cols-1 gap-s-8 desktop:grid-cols-12">
        <div className="desktop:col-span-7">
          <FactsList
            project={data}
            canChangePhase={canChangePhase}
            onChangePhase={onOpenPhaseDialog}
            phaseChangeOfflineReason={offline ? t("states.offline.readOnly") : undefined}
          />
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
          <MilestonesCard projectId={data.id} milestones={data.milestones} today={today} />
          <RisksCard projectId={data.id} risks={data.risks} />
          <IssuesCard projectId={data.id} issues={data.issues} />
          <ContractsCard
            projectId={data.id}
            roles={roles}
            contracts={contracts}
            loading={contractsLoading}
            error={contractsError}
          />
          <OpenPermitsCard permits={openPermits} loading={openPermitsLoading} error={openPermitsError} />
        </div>
      </div>

      {canChangePhase && (
        <PhaseDialog
          open={phaseDialogOpen}
          currentPhase={data.phase}
          isAdmin={isAdmin(roles)}
          submitting={phaseSubmitting}
          apiError={phaseApiError}
          onCancel={onClosePhaseDialog}
          onSubmit={onSubmitPhaseChange}
        />
      )}
    </>
  );
}
