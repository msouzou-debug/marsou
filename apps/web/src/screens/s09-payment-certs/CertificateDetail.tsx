"use client";

// S09 — R11
//
/**
 * CertificateDetail — the pure S09 detail page. Every derived field the API
 * sends (retention held, previous certified, net payable) is shown
 * read-only, retention on its own `<dt>/<dd>` line — RULE: never folded into
 * net payable, and never recomputed here; this component only ever displays
 * `cert.netPayable` as given.
 *
 * Transition buttons appear by role and by the certificate's own status:
 * - `DRAFT` → «Έγκριση μηχανικού» (`canApprovePaymentCertEngineer`). RULE
 *   (R11, same pattern as S08/ADR-0015): disabled with the segregation
 *   sentence when the viewer created the certificate — a different person
 *   must approve their own work.
 * - `ENGINEER_APPROVED` → «Παραλαβή από Οικονομικές» (finance/admin),
 *   requires a SAP invoice ref.
 * - `FINANCE_RECEIVED` → «Εξόφληση» (finance/admin), requires a paid date,
 *   with the retention-release checkbox and its warning sentence when the
 *   contract's defects liability period has not ended yet — a warning,
 *   never a block (R31's own rule, applied here).
 * - `PAID` → final; no actions.
 *
 * | Prop             | Type                | Notes                                                    |
 * |------------------|---------------------|---------------------------------------------------------------|
 * | cert             | PaymentCert?        |                                                                  |
 * | contractNo       | string?             |                                                                  |
 * | state            | CertificateDetailState |                                                              |
 * | roles            | AppRole[]           |                                                                  |
 * | meUserId         | string              | Compared to `cert.createdById` for the segregation rule.        |
 * | dlpEnded         | boolean?            | Computed by the screen from the contract's own dates; `undefined` while the contract is still loading — the warning is simply not shown yet. |
 * | onTransition     | (to, extra) => void |                                                                  |
 * | transitioning    | boolean             |                                                                  |
 * | transitionApiError | string?           |                                                                  |
 */
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import type { AppRole, PaymentCert, PaymentCertStatus } from "@ecapital/shared";
import { canApprovePaymentCertEngineer, canProcessPaymentCertFinance } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { formatDate, formatEUR } from "@/lib/format";

export type CertificateDetailState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface TransitionExtra {
  sapInvoiceRef?: string | null;
  paidDate?: string | null;
  retentionReleased?: boolean;
}

export interface CertificateDetailProps {
  cert?: PaymentCert;
  contractNo?: string;
  state: CertificateDetailState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  meUserId?: string;
  dlpEnded?: boolean;
  onTransition: (to: PaymentCertStatus, extra: TransitionExtra) => void;
  transitioning?: boolean;
  transitionApiError?: string;
}

export function CertificateDetail({
  cert,
  contractNo,
  state,
  onRetry,
  noPermission,
  roles = [],
  meUserId = "",
  dlpEnded,
  onTransition,
  transitioning = false,
  transitionApiError,
}: CertificateDetailProps) {
  const t = useTranslations();
  const [sapInvoiceRef, setSapInvoiceRef] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [retentionReleased, setRetentionReleased] = useState(false);

  if (state === "noPermission") return <>{noPermission}</>;

  if (state === "loading" || state === "error" || !cert) {
    return (
      <div className="rounded-k border border-k-grey bg-k-white p-s-8 text-center">
        {state === "loading" ? (
          <p aria-busy="true" className="text-fs-16 text-k-text">
            {t("common.loading")}
          </p>
        ) : (
          <>
            <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
                {t("common.retry")}
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  const isCreator = cert.createdById === meUserId;
  const canEngineerApprove = canApprovePaymentCertEngineer(roles);
  const canFinance = canProcessPaymentCertFinance(roles);

  return (
    <>
      <PageTitle eyebrow={contractNo ?? ""} title={t("screens.s09.detailTitle", { number: cert.number })} />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <dl className="grid gap-s-4 rounded-k border border-k-grey bg-k-white p-s-4 tablet:grid-cols-3">
        <div>
          <dt className="text-fs-14 text-k-text">{t("screens.s09.columns.period")}</dt>
          <dd className="text-fs-16 text-k-ink">
            {cert.periodFrom} — {cert.periodTo}
          </dd>
        </div>
        <div>
          <dt className="text-fs-14 text-k-text">{t("screens.s09.columns.workDone")}</dt>
          <dd className="num text-fs-16 text-k-ink">{formatEUR(cert.workDoneValue)}</dd>
        </div>
        <div>
          <dt className="text-fs-14 text-k-text">{t("screens.s09.columns.materials")}</dt>
          <dd className="num text-fs-16 text-k-ink">{formatEUR(cert.materialsOnSite)}</dd>
        </div>
        {/* RULE (build brief §5 S09): retention is its own line, never folded into net payable. */}
        <div>
          <dt className="text-fs-14 text-k-text">{t("screens.s09.detail.retentionHeld")}</dt>
          <dd className="num text-fs-16 text-k-ink">{formatEUR(cert.retentionHeld)}</dd>
        </div>
        <div>
          <dt className="text-fs-14 text-k-text">{t("screens.s09.detail.previousCertified")}</dt>
          <dd className="num text-fs-16 text-k-ink">{formatEUR(cert.previousCertified)}</dd>
        </div>
        <div>
          <dt className="text-fs-14 text-k-text">{t("screens.s09.columns.netPayable")}</dt>
          <dd className="num text-fs-16 font-bold text-k-ink">{formatEUR(cert.netPayable)}</dd>
        </div>
        <div>
          <dt className="text-fs-14 text-k-text">{t("screens.s09.columns.status")}</dt>
          <dd className="text-fs-16 text-k-ink">{t(`screens.s09.status.${cert.status}`)}</dd>
        </div>
        <div>
          <dt className="text-fs-14 text-k-text">{t("screens.s09.detail.createdBy")}</dt>
          <dd className="text-fs-16 text-k-ink">{cert.createdByName}</dd>
        </div>
        {cert.approvedByName && (
          <div>
            <dt className="text-fs-14 text-k-text">{t("screens.s09.detail.approvedBy")}</dt>
            <dd className="text-fs-16 text-k-ink">
              {cert.approvedByName}
              {cert.approvedAt ? ` · ${formatDate(cert.approvedAt)}` : ""}
            </dd>
          </div>
        )}
        {cert.sapInvoiceRef && (
          <div>
            <dt className="text-fs-14 text-k-text">{t("screens.s09.detail.sapInvoiceRef")}</dt>
            <dd className="text-fs-16 text-k-ink">{cert.sapInvoiceRef}</dd>
          </div>
        )}
        {cert.paidDate && (
          <div>
            <dt className="text-fs-14 text-k-text">{t("screens.s09.detail.paidDate")}</dt>
            <dd className="text-fs-16 text-k-ink">{formatDate(cert.paidDate)}</dd>
          </div>
        )}
      </dl>

      {transitionApiError && (
        <p role="alert" className="mt-s-4 rounded-k border border-k-red bg-k-white p-s-3 text-fs-14 text-k-red">
          {transitionApiError}
        </p>
      )}

      {cert.status === "DRAFT" && canEngineerApprove && (
        <div className="mt-s-4 rounded-k border border-k-grey bg-k-white p-s-4">
          <button
            type="button"
            onClick={() => onTransition("ENGINEER_APPROVED", {})}
            disabled={transitioning || isCreator}
            className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:cursor-not-allowed disabled:bg-k-grey disabled:text-k-text-muted"
          >
            {transitioning && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
            {t("screens.s09.transitions.engineerApprove")}
          </button>
          {isCreator && <p className="mt-s-2 text-fs-12 text-k-text">{t("screens.s09.transitions.sameUserApprovalHint")}</p>}
        </div>
      )}

      {cert.status === "ENGINEER_APPROVED" && canFinance && (
        <div className="mt-s-4 rounded-k border border-k-grey bg-k-white p-s-4">
          <label htmlFor="cert-sap-ref" className="text-fs-14 text-k-text">
            {t("screens.s09.transitions.sapInvoiceRefLabel")}
          </label>
          <input
            id="cert-sap-ref"
            value={sapInvoiceRef}
            onChange={(e) => setSapInvoiceRef(e.target.value)}
            className="mt-s-1 h-11 w-[240px] rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
          />
          <div className="mt-s-3">
            <button
              type="button"
              onClick={() => onTransition("FINANCE_RECEIVED", { sapInvoiceRef: sapInvoiceRef.trim() || null })}
              disabled={transitioning || sapInvoiceRef.trim() === ""}
              className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              {transitioning && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
              {t("screens.s09.transitions.financeReceive")}
            </button>
          </div>
        </div>
      )}

      {cert.status === "FINANCE_RECEIVED" && canFinance && (
        <div className="mt-s-4 rounded-k border border-k-grey bg-k-white p-s-4">
          <label htmlFor="cert-paid-date" className="text-fs-14 text-k-text">
            {t("screens.s09.transitions.paidDateLabel")}
          </label>
          <input
            id="cert-paid-date"
            type="date"
            value={paidDate}
            onChange={(e) => setPaidDate(e.target.value)}
            className="mt-s-1 h-11 w-[200px] rounded-k border border-k-grey px-s-3 text-fs-16 text-k-ink"
          />

          <label className="mt-s-4 flex items-center gap-s-2 text-fs-14 text-k-ink">
            <input type="checkbox" checked={retentionReleased} onChange={(e) => setRetentionReleased(e.target.checked)} />
            {t("screens.s09.detail.retentionRelease")}
          </label>
          {/* RULE (R31): warn, never block — an amber note, not a disabled button. */}
          {retentionReleased && dlpEnded === false && (
            <p className="mt-s-2 rounded-k border border-k-amber bg-k-amber-bg px-s-3 py-s-2 text-fs-14 text-k-ink">
              {t("screens.s09.detail.retentionReleaseWarning")}
            </p>
          )}

          <div className="mt-s-3">
            <button
              type="button"
              onClick={() => onTransition("PAID", { paidDate: paidDate || null, retentionReleased })}
              disabled={transitioning || paidDate.trim() === ""}
              className="flex h-11 items-center justify-center gap-s-2 rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k disabled:opacity-60"
            >
              {transitioning && <LoaderCircle size={20} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />}
              {t("screens.s09.transitions.pay")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
