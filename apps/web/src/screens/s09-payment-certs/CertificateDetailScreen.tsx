"use client";

// S09 — R11
//
/**
 * CertificateDetailScreen — the network-aware wrapper around
 * `CertificateDetail`. Owns `usePaymentCert()`, a light `useContract()` call
 * for the header and the defects-liability-end date (`completionDate` +
 * `defectsLiabilityMonths`, computed here rather than adding a derived field
 * to the shared `Contract` schema for one warning sentence), and
 * `POST /payment-certs/:id/transition`.
 *
 * FLAGGED assumption: the shared `PaymentCertTransition` schema carries
 * `sapInvoiceRef`/`paidDate` but not a retention flag, and the endpoint list
 * this build was given has no separate "release retention" route. The
 * retention-release checkbox (build brief §5 S09) is sent as an extra
 * `retentionReleased` field alongside the `PAID` transition, read loosely
 * (`TransitionResponse` below) rather than widening the shared contract for
 * one boolean — worth confirming against the API's real shape once M2 lands.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole, PaymentCertStatus } from "@ecapital/shared";
import { PaymentCert as PaymentCertSchema } from "@ecapital/shared";
import { z } from "zod";
import { ApiError, apiMutate } from "@/data/client";
import { useContract, usePaymentCert } from "@/data/queries";
import { CertificateDetail, type CertificateDetailState, type TransitionExtra } from "./CertificateDetail";

export interface CertificateDetailScreenProps {
  certId: string;
  roles: AppRole[];
  meUserId: string;
  noPermission: ReactNode;
  /** Injectable "now" for the defects-liability-end check, the same pattern `ContractFacts`/`Defects` use for their own date rules. */
  today?: Date;
}

const TransitionResponse = PaymentCertSchema.and(z.object({ retentionReleased: z.boolean().optional() }).partial());

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

/** Months added to an ISO date, for the defects-liability-end computation. */
function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function CertificateDetailScreen({ certId, roles, meUserId, noPermission, today = new Date() }: CertificateDetailScreenProps) {
  const { data, error, isLoading, refetch } = usePaymentCert(certId);
  const contract = useContract(data?.contractId ?? "");
  const online = useOnlineStatus();

  const [transitioning, setTransitioning] = useState(false);
  const [transitionApiError, setTransitionApiError] = useState<string | undefined>(undefined);

  let state: CertificateDetailState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  } else {
    state = "default";
  }

  const dlpEnded =
    contract.data?.completionDate && !Number.isNaN(new Date(contract.data.completionDate).getTime())
      ? addMonths(contract.data.completionDate, contract.data.defectsLiabilityMonths).getTime() <= today.getTime()
      : undefined;

  async function transition(to: PaymentCertStatus, extra: TransitionExtra): Promise<void> {
    setTransitioning(true);
    setTransitionApiError(undefined);
    try {
      await apiMutate(
        `/payment-certs/${encodeURIComponent(certId)}/transition`,
        "POST",
        { to, sapInvoiceRef: extra.sapInvoiceRef ?? null, paidDate: extra.paidDate ?? null, retentionReleased: extra.retentionReleased },
        TransitionResponse,
      );
      await refetch();
    } catch (submitError) {
      setTransitionApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setTransitioning(false);
    }
  }

  return (
    <CertificateDetail
      cert={data}
      contractNo={contract.data?.contractNo}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      meUserId={meUserId}
      dlpEnded={dlpEnded}
      onTransition={(to, extra) => void transition(to, extra)}
      transitioning={transitioning}
      transitionApiError={transitionApiError}
    />
  );
}
