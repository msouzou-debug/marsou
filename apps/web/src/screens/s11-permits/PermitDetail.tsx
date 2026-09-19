"use client";

// Permit detail — R19–R25
//
/**
 * PermitDetail — the pure permit-record screen body (UI instructions §5
 * "Permit detail", item 4 of the M3 task).
 *
 * | Prop              | Type                | Notes                                                              |
 * |-------------------|---------------------|-----------------------------------------------------------------------|
 * | permit            | ShutdownPermit?     | Ignored in `noPermission` \| `loading` \| `error`.                      |
 * | state             | PermitDetailState   | No `empty` — a record page always names one permit or none at all.      |
 * | roles             | AppRole[]           | `me.roles` — the write/decide gates (`@/auth/roles`).                   |
 * | myUserId          | string              | For "a user's own pending line" (RULE below) and the clinical-owner gate.|
 * | orgUnits          | OrgUnit[]           | For the unit name.                                                     |
 * | now               | Date?               | Injectable clock for the window/breach rules; defaults to `new Date()`. |
 * | onRetry           | () => void?         |                                                                        |
 * | noPermission      | ReactNode           |                                                                        |
 * | onStartWork       | () => void          | «Έναρξη εργασιών».                                                    |
 * | closeout*         | —                    | The «Κλείσιμο» dialog's open/value/saving/apiError, owned by the Screen.|
 * | onOpenCloseout / onChangeCloseout / onSubmitCloseout / onCancelCloseout | — | Wired by the Screen. |
 * | reject*           | —                    | The «Απόρριψη» dialog's open/comment/saving/apiError.                   |
 * | onOpenReject / onChangeRejectComment / onSubmitReject / onCancelReject | — | Wired by the Screen. |
 * | onDecide          | (approvalId, decision, comment?) => void | A user's own pending approval line.                       |
 *
 * RULE: «Έναρξη εργασιών» is disabled outside the planned window (or before
 * APPROVED), with the reason in the button's `title` —
 * `startWorkDisabledReasonKey` (`src/lib/permit-rules.ts`).
 *
 * RULE: the Έγκριση/Επιστροφή με σχόλια/Απόρριψη buttons render only on the
 * approval line where `approval.approverId === myUserId && decision === "PENDING"`
 * — never on anyone else's line, never on a decided one.
 */
import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Printer } from "lucide-react";
import type { AppRole, CloseoutChecklist as CloseoutChecklistValue, OrgUnit, ShutdownPermit } from "@ecapital/shared";
import { canOperatePermit, canRejectPermit } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { CloseoutChecklist } from "@/components/closeout-checklist";
import { IcraBadge } from "@/components/icra-badge";
import { PermitBanner } from "@/components/permit-banner";
import { SlaChip } from "@/components/sla-chip";
import { Timeline } from "@/components/timeline";
import type { Locale } from "@/i18n/config";
import { formatDate, formatDateTime, formatDateTimeRange } from "@/lib/format";
import { closeoutComplete, permitBannerState, permitTimelineFrom, startWorkDisabledReasonKey } from "@/lib/permit-rules";

export type PermitDetailState = "default" | "loading" | "error" | "noPermission" | "offline";

// RULE (contract note, `PermitApproval.dueAt`): the SLA length is not itself
// serialized — the contract's own comment says "2 working days, like an
// RFI's default" — so this is the same 48h every approval line's SlaChip
// uses until the API sends `slaHours` explicitly. ASSUMPTION, flagged.
const APPROVAL_SLA_HOURS = 48;

export interface PermitDetailProps {
  permit?: ShutdownPermit;
  state: PermitDetailState;
  roles: AppRole[];
  myUserId: string;
  orgUnits: OrgUnit[];
  now?: Date;
  onRetry?: () => void;
  noPermission: ReactNode;
  onStartWork: () => void;
  closeoutOpen: boolean;
  closeoutValue: CloseoutChecklistValue;
  closeoutSaving: boolean;
  closeoutApiError?: string;
  onOpenCloseout: () => void;
  onChangeCloseout: (next: CloseoutChecklistValue) => void;
  onSubmitCloseout: () => void;
  onCancelCloseout: () => void;
  rejectOpen: boolean;
  rejectComment: string;
  rejectSaving: boolean;
  rejectApiError?: string;
  onOpenReject: () => void;
  onChangeRejectComment: (value: string) => void;
  onSubmitReject: () => void;
  onCancelReject: () => void;
  onDecide: (approvalId: string, decision: "APPROVED" | "RETURNED" | "REJECTED", comment?: string) => void;
}

const START_WORK_REASON_KEY: Record<string, string> = {
  notApproved: "screens.s11detail.startWork.notApproved",
  beforeWindow: "screens.s11detail.startWork.beforeWindow",
  afterWindow: "screens.s11detail.startWork.afterWindow",
};

function DecideRow({
  approvalId,
  onDecide,
}: {
  approvalId: string;
  onDecide: (approvalId: string, decision: "APPROVED" | "RETURNED" | "REJECTED", comment?: string) => void;
}) {
  const t = useTranslations();
  const [mode, setMode] = useState<"idle" | "return" | "reject">("idle");
  const [comment, setComment] = useState("");

  if (mode !== "idle") {
    return (
      <div className="mt-s-2 flex flex-col gap-s-2">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder={t("screens.s11detail.decide.commentPlaceholder")}
          className="rounded-k border border-k-grey p-s-2 text-fs-14"
        />
        <div className="flex gap-s-2">
          <button
            type="button"
            disabled={!comment.trim()}
            onClick={() => onDecide(approvalId, mode === "return" ? "RETURNED" : "REJECTED", comment)}
            className="rounded-k bg-k-blue px-s-3 py-s-2 text-fs-14 font-bold text-k-white disabled:bg-k-grey disabled:text-k-text-muted"
          >
            {mode === "return" ? t("buttons.returnWithComments") : t("screens.s11detail.decide.reject")}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="rounded-k px-s-3 py-s-2 text-fs-14 text-k-text">
            {t("buttons.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-s-2 flex gap-s-2">
      <button
        type="button"
        onClick={() => onDecide(approvalId, "APPROVED")}
        className="rounded-k bg-k-blue px-s-3 py-s-2 text-fs-14 font-bold text-k-white shadow-k"
      >
        {t("buttons.approve")}
      </button>
      <button
        type="button"
        onClick={() => setMode("return")}
        className="rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-text"
      >
        {t("buttons.returnWithComments")}
      </button>
      <button
        type="button"
        onClick={() => setMode("reject")}
        className="rounded-k border border-k-red px-s-3 py-s-2 text-fs-14 text-k-red"
      >
        {t("screens.s11detail.decide.reject")}
      </button>
    </div>
  );
}

export function PermitDetail(props: PermitDetailProps) {
  const {
    permit,
    state,
    roles,
    myUserId,
    orgUnits,
    now = new Date(),
    onRetry,
    noPermission,
    onStartWork,
    closeoutOpen,
    closeoutValue,
    closeoutSaving,
    closeoutApiError,
    onOpenCloseout,
    onChangeCloseout,
    onSubmitCloseout,
    onCancelCloseout,
    rejectOpen,
    rejectComment,
    rejectSaving,
    rejectApiError,
    onOpenReject,
    onChangeRejectComment,
    onSubmitReject,
    onCancelReject,
    onDecide,
  } = props;
  const t = useTranslations();
  const locale = useLocale() as Locale;

  if (state === "noPermission") return <>{noPermission}</>;
  if (state === "loading" || !permit) {
    return <div aria-busy="true" className="h-s-12 animate-pulse rounded-k bg-k-grey" />;
  }
  if (state === "error") {
    return (
      <div className="p-s-8 text-center">
        <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
            {t("common.retry")}
          </button>
        )}
      </div>
    );
  }

  const unitName = orgUnits.find((u) => u.id === permit.orgUnitId);
  const unitLabel = unitName ? (locale === "en" ? unitName.nameEn : unitName.nameEl) : permit.orgUnitId;
  const bannerState = permitBannerState(permit.status);
  const canOperate = state !== "offline" && canOperatePermit(roles);
  const canReject = state !== "offline" && canRejectPermit(roles);
  const startDisabledKey = startWorkDisabledReasonKey(permit.status, permit.plannedStart, permit.plannedEnd, now);
  const directAreas = permit.affectedAreas.filter((a) => a.impact === "DIRECT");
  const indirectAreas = permit.affectedAreas.filter((a) => a.impact === "INDIRECT");
  const timeline = permitTimelineFrom(permit, (key) => t(`screens.s11detail.timeline.${key}`));
  const isClinicalOwner = permit.closeout?.clinicalAcceptanceById === myUserId || roles.includes("clinical_approver");

  return (
    <>
      <PageTitle eyebrow={permit.ref ?? t("screens.s11.noRefYet")} title={permit.titleEl} />

      {bannerState ? (
        <div className="mb-s-5">
          <PermitBanner
            state={bannerState}
            validFrom={permit.plannedStart}
            validTo={permit.plannedEnd}
            icraClass={permit.icra?.icraClass ?? "I"}
          />
          {bannerState === "expired" && (
            <p className="mt-s-2 text-fs-14 text-k-red">{t("screens.s11detail.breachLine", { time: formatDateTime(permit.breachedAt ?? permit.plannedEnd) })}</p>
          )}
        </div>
      ) : (
        permit.status === "CLOSED" && (
          <p className="mb-s-5 text-fs-14 text-k-text">
            {t("screens.s11detail.closedSummary", { date: permit.closedAt ? formatDate(permit.closedAt) : "" })}
          </p>
        )
      )}

      {permit.clashes.length > 0 && (
        <div className="mb-s-5 rounded-k border border-k-amber bg-k-amber-bg p-s-4">
          {permit.clashes.map((clash) => (
            <p key={clash.otherPermitId} className="text-fs-14 text-k-ink">
              {t(clash.messageKey, { ref: clash.otherPermitRef ?? "" })}
            </p>
          ))}
        </div>
      )}

      {/* RULE (task item 4): `self-start` keeps each column its own natural
          height instead of the parent grid stretching it to match its
          sibling's row — without it, a shorter left column's own rows
          (`align-content: normal` ⇒ stretch on a grid container) spread out
          to fill the extra height, opening a gap between «Στοιχεία» and
          «Άμεσα επηρεαζόμενοι χώροι» that has nothing to do with either. */}
      <div className="grid grid-cols-1 gap-s-6 desktop:grid-cols-2">
        <div className="grid gap-s-5 self-start">
          <section>
            <h2 className="text-fs-20 text-k-blue-deep">{t("screens.s11detail.facts")}</h2>
            <dl className="mt-s-3 grid gap-s-2 text-fs-14">
              <div><dt className="text-k-text-muted">{t("common.unit")}</dt><dd className="text-k-ink">{unitLabel}</dd></div>
              <div><dt className="text-k-text-muted">{t("screens.s11.columns.systems")}</dt><dd className="text-k-ink">{permit.systems.map((s) => t(`permitSystem.${s}`)).join(", ")}</dd></div>
              <div><dt className="text-k-text-muted">{t("screens.s11.columns.window")}</dt><dd className="num text-k-ink">{formatDateTimeRange(permit.plannedStart, permit.plannedEnd)}</dd></div>
              {permit.icra && (
                <div><dt className="text-k-text-muted">{t("screens.s11.columns.icraClass")}</dt><dd><IcraBadge icraClass={permit.icra.icraClass} size="list" /></dd></div>
              )}
            </dl>
          </section>

          <section>
            <h3 className="text-fs-16 font-bold text-k-ink">{t("screens.s11detail.areasDirect")}</h3>
            <ul className="mt-s-2 grid gap-s-1 text-fs-14">
              {directAreas.map((a) => (
                <li key={a.areaId}>{a.nameEl} — {t(`riskGroup.${a.patientRiskGroup}`)}</li>
              ))}
            </ul>
            {indirectAreas.length > 0 && (
              <>
                <h3 className="mt-s-3 text-fs-16 font-bold text-k-ink">{t("screens.s11detail.areasIndirect")}</h3>
                <ul className="mt-s-2 grid gap-s-1 text-fs-14">
                  {indirectAreas.map((a) => (
                    <li key={a.areaId}>
                      {a.nameEl} — {t(`riskGroup.${a.patientRiskGroup}`)} —{" "}
                      {t("components.area-picker.viaSystem", { system: a.viaSystem ? t(`permitSystem.${a.viaSystem}`) : "" })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {permit.ilsm?.required && (
            <section>
              <h3 className="text-fs-16 font-bold text-k-ink">{t("screens.s11detail.ilsmTitle")}</h3>
              <ul className="mt-s-2 grid gap-s-1 text-fs-14">
                {permit.ilsm.measures.map((m) => (
                  <li key={m}>{t(`ilsmMeasure.${m}`)}</li>
                ))}
              </ul>
              <p className="mt-s-1 text-fs-14 text-k-text">
                {permit.ilsm.fireOfficerNotifiedAt
                  ? t("screens.s11detail.fireOfficerNotified", { date: formatDateTime(permit.ilsm.fireOfficerNotifiedAt) })
                  : t("screens.s11detail.fireOfficerNotNotified")}
              </p>
            </section>
          )}
        </div>

        <div className="grid gap-s-5 self-start">
          <section>
            <h2 className="text-fs-20 text-k-blue-deep">{t("screens.s11detail.approvals")}</h2>
            <ul className="mt-s-3 grid gap-s-3">
              {permit.approvals.map((approval) => (
                <li key={approval.id} className="rounded-k border border-k-grey p-s-3">
                  <div className="flex flex-wrap items-center justify-between gap-s-2 text-fs-14">
                    <span className="font-bold text-k-ink">{t(`approvalRole.${approval.role}`)}</span>
                    {approval.decision === "PENDING" ? (
                      <SlaChip dueAt={approval.dueAt} totalHours={APPROVAL_SLA_HOURS} />
                    ) : (
                      <span className="text-k-text">{t(`approvalDecision.${approval.decision}`)}</span>
                    )}
                  </div>
                  <p className="mt-s-1 text-fs-14 text-k-text">{t(`routingReason.${approval.reason}`)}</p>
                  {approval.areaNameEl && <p className="text-fs-12 text-k-text-muted">{approval.areaNameEl}</p>}
                  {approval.approverName && <p className="text-fs-12 text-k-text-muted">{approval.approverName}</p>}
                  {approval.commentEl && <p className="mt-s-1 text-fs-14 text-k-ink">{approval.commentEl}</p>}
                  {/* RULE (ADR-0015's segregation, applied here per ADR-0026):
                      the requester never gets decide buttons on their own
                      permit, even on a line the API resolved to them — the
                      API itself now avoids that resolution and refuses the
                      decision with 409 either way, so this is the second,
                      visible half of the same guard. */}
                  {approval.decision === "PENDING" && approval.approverId === myUserId && (
                    permit.requestedById === myUserId ? (
                      <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s11detail.decide.selfApproval")}</p>
                    ) : (
                      <DecideRow approvalId={approval.id} onDecide={onDecide} />
                    )
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-fs-20 text-k-blue-deep">{t("screens.s11detail.timelineTitle")}</h2>
            <div className="mt-s-3">
              <Timeline entries={timeline} />
            </div>
          </section>
        </div>
      </div>

      <div className="mt-s-6 flex flex-wrap items-center gap-s-3 border-t border-k-grey pt-s-4">
        {canOperate && (
          <button
            type="button"
            onClick={onStartWork}
            disabled={startDisabledKey !== null}
            title={startDisabledKey ? t(START_WORK_REASON_KEY[startDisabledKey]) : undefined}
            className="rounded-k bg-k-blue px-s-4 py-s-3 text-fs-14 font-bold text-k-white shadow-k disabled:bg-k-grey disabled:text-k-text-muted"
          >
            {t("screens.s11detail.startWork.button")}
          </button>
        )}
        {canOperate && (permit.status === "ACTIVE" || permit.status === "BREACH") && (
          <button type="button" onClick={onOpenCloseout} className="rounded-k border border-k-grey px-s-4 py-s-3 text-fs-14 text-k-text">
            {t("screens.s11detail.closeout.button")}
          </button>
        )}
        {canReject && permit.status !== "CLOSED" && permit.status !== "REJECTED" && (
          <button type="button" onClick={onOpenReject} className="rounded-k border border-k-red px-s-4 py-s-3 text-fs-14 text-k-red">
            {t("screens.s11detail.decide.reject")}
          </button>
        )}
        <Link
          href={`/permits/${encodeURIComponent(permit.id)}/print`}
          className="flex items-center gap-s-2 rounded-k border border-k-grey px-s-4 py-s-3 text-fs-14 text-k-blue-deep"
        >
          <Printer size={20} strokeWidth={1.5} aria-hidden="true" />
          {t("buttons.print")}
        </Link>
      </div>

      {closeoutOpen && (
        <div role="dialog" aria-label={t("screens.s11detail.closeout.title")} className="fixed inset-0 z-30 flex items-center justify-center bg-k-ink/60 p-s-4">
          <div className="max-h-[90vh] w-full max-w-[560px] overflow-auto rounded-k bg-k-white p-s-6 shadow-k">
            <h2 className="text-fs-20">{t("screens.s11detail.closeout.title")}</h2>
            <div className="mt-s-4">
              <CloseoutChecklist
                value={closeoutValue}
                onChange={onChangeCloseout}
                isClinicalOwner={isClinicalOwner}
                approverName={permit.requestedByName}
                approverId={myUserId}
              />
            </div>
            {closeoutApiError && <p role="alert" className="mt-s-3 text-fs-14 text-k-red">{closeoutApiError}</p>}
            <div className="mt-s-5 flex justify-end gap-s-3">
              <button type="button" onClick={onCancelCloseout} className="rounded-k px-s-5 py-s-3 text-fs-14 text-k-text">
                {t("buttons.cancel")}
              </button>
              <button
                type="button"
                onClick={onSubmitCloseout}
                disabled={closeoutSaving || !closeoutComplete(closeoutValue)}
                className="rounded-k bg-k-blue px-s-5 py-s-3 text-fs-14 font-bold text-k-white shadow-k disabled:bg-k-grey disabled:text-k-text-muted"
              >
                {t("buttons.complete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectOpen && (
        <div role="dialog" aria-label={t("screens.s11detail.decide.reject")} className="fixed inset-0 z-30 flex items-center justify-center bg-k-ink/60 p-s-4">
          <div className="w-full max-w-[420px] rounded-k bg-k-white p-s-6 shadow-k">
            <h2 className="text-fs-20">{t("screens.s11detail.rejectDialog.title")}</h2>
            <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s11detail.rejectDialog.consequence")}</p>
            <textarea
              value={rejectComment}
              onChange={(e) => onChangeRejectComment(e.target.value)}
              rows={3}
              className="mt-s-3 w-full rounded-k border border-k-grey p-s-3 text-fs-14"
            />
            {rejectApiError && <p role="alert" className="mt-s-2 text-fs-14 text-k-red">{rejectApiError}</p>}
            <div className="mt-s-4 flex justify-end gap-s-3">
              <button type="button" onClick={onCancelReject} className="rounded-k px-s-5 py-s-3 text-fs-14 text-k-text">
                {t("buttons.cancel")}
              </button>
              <button
                type="button"
                onClick={onSubmitReject}
                disabled={rejectSaving || !rejectComment.trim()}
                className="rounded-k bg-k-red px-s-5 py-s-3 text-fs-14 font-bold text-k-white disabled:bg-k-grey disabled:text-k-text-muted"
              >
                {t("screens.s11detail.decide.reject")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
