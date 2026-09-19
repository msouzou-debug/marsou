"use client";

// Permit detail — R19–R25
//
// PermitDetailScreen — the network-aware wrapper around `PermitDetail`.
// Owns `usePermit` and every mutation: `POST /permits/:id/transition`
// (ACTIVE, CLOSED, REJECTED) and `POST /permits/:id/approvals/:approvalId/decide`.
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole, CloseoutChecklist as CloseoutChecklistValue, Me, OrgUnit, ShutdownPermit } from "@ecapital/shared";
import { ShutdownPermit as ShutdownPermitSchema } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { usePermit } from "@/data/queries";
import { PermitDetail, type PermitDetailState } from "./PermitDetail";

export interface PermitDetailScreenProps {
  permitId: string;
  roles: AppRole[];
  me?: Me;
  orgUnits: OrgUnit[];
  noPermission: ReactNode;
}

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

const EMPTY_CLOSEOUT: CloseoutChecklistValue = {
  barriersRemoved: false,
  areaCleaned: false,
  airBalanceRestored: false,
  systemsTestedAndReturned: false,
  fireSystemsReenabled: false,
  noteEl: null,
  clinicalAcceptanceById: null,
  clinicalAcceptanceByName: null,
  clinicalAcceptanceAt: null,
};

export function PermitDetailScreen({ permitId, roles, me, orgUnits, noPermission }: PermitDetailScreenProps) {
  const { data, error, isLoading, refetch } = usePermit(permitId);
  const online = useOnlineStatus();

  const [closeoutOpen, setCloseoutOpen] = useState(false);
  const [closeoutValue, setCloseoutValue] = useState<CloseoutChecklistValue>(EMPTY_CLOSEOUT);
  const [closeoutSaving, setCloseoutSaving] = useState(false);
  const [closeoutApiError, setCloseoutApiError] = useState<string | undefined>(undefined);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [rejectSaving, setRejectSaving] = useState(false);
  const [rejectApiError, setRejectApiError] = useState<string | undefined>(undefined);

  let state: PermitDetailState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  } else {
    state = "default";
  }

  async function transition(body: { to: "ACTIVE" | "CLOSED" | "REJECTED"; commentEl?: string | null; closeout?: CloseoutChecklistValue }) {
    await apiMutate<ShutdownPermit>(`/permits/${encodeURIComponent(permitId)}/transition`, "POST", body, ShutdownPermitSchema);
    await refetch();
  }

  async function handleStartWork(): Promise<void> {
    try {
      await transition({ to: "ACTIVE" });
    } catch {
      /* the button's own disabled/title already covers the expected refusal; a surprise one shows nowhere yet — flagged for a toast in a follow-up */
    }
  }

  function openCloseout() {
    setCloseoutApiError(undefined);
    setCloseoutValue(data?.closeout ?? EMPTY_CLOSEOUT);
    setCloseoutOpen(true);
  }

  async function submitCloseout(): Promise<void> {
    setCloseoutSaving(true);
    setCloseoutApiError(undefined);
    try {
      await transition({ to: "CLOSED", closeout: closeoutValue });
      setCloseoutOpen(false);
    } catch (submitError) {
      setCloseoutApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setCloseoutSaving(false);
    }
  }

  function openReject() {
    setRejectApiError(undefined);
    setRejectComment("");
    setRejectOpen(true);
  }

  async function submitReject(): Promise<void> {
    setRejectSaving(true);
    setRejectApiError(undefined);
    try {
      await transition({ to: "REJECTED", commentEl: rejectComment });
      setRejectOpen(false);
    } catch (submitError) {
      setRejectApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setRejectSaving(false);
    }
  }

  async function handleDecide(approvalId: string, decision: "APPROVED" | "RETURNED" | "REJECTED", comment?: string): Promise<void> {
    await apiMutate(
      `/permits/${encodeURIComponent(permitId)}/approvals/${encodeURIComponent(approvalId)}/decide`,
      "POST",
      { decision, commentEl: comment ?? null },
      ShutdownPermitSchema,
    );
    await refetch();
  }

  return (
    <PermitDetail
      permit={data}
      state={state}
      roles={roles}
      myUserId={me?.userId ?? ""}
      orgUnits={orgUnits}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      onStartWork={() => void handleStartWork()}
      closeoutOpen={closeoutOpen}
      closeoutValue={closeoutValue}
      closeoutSaving={closeoutSaving}
      closeoutApiError={closeoutApiError}
      onOpenCloseout={openCloseout}
      onChangeCloseout={setCloseoutValue}
      onSubmitCloseout={() => void submitCloseout()}
      onCancelCloseout={() => setCloseoutOpen(false)}
      rejectOpen={rejectOpen}
      rejectComment={rejectComment}
      rejectSaving={rejectSaving}
      rejectApiError={rejectApiError}
      onOpenReject={openReject}
      onChangeRejectComment={setRejectComment}
      onSubmitReject={() => void submitReject()}
      onCancelReject={() => setRejectOpen(false)}
      onDecide={(approvalId, decision, comment) => void handleDecide(approvalId, decision, comment)}
    />
  );
}
