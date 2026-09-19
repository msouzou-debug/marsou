"use client";

// S07b — R09 (ADR-0017)
//
/**
 * RfisScreen — the network-aware wrapper around `Rfis` (same Screen/pure
 * split as S07's own pair). Reads the contract (`useContract`, for the
 * eyebrow, tab strip and its counts) and the contract's own RFI list
 * (`useRfis`) side by side, and owns every mutation: create, answer, close.
 * Every one refetches both queries and closes the sheet on success.
 *
 * | Prop         | Type       | Notes                                             |
 * |--------------|------------|----------------------------------------------------|
 * | contractId   | string     | The `[id]` route segment.                           |
 * | roles        | AppRole[]  | `me.roles` — the write gate.                        |
 * | noPermission | ReactNode  | The shell's `NoPermission`.                         |
 */
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole, Rfi } from "@ecapital/shared";
import { Rfi as RfiSchema } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useContract, useRfis } from "@/data/queries";
import { Rfis, type RfisScreenState } from "./Rfis";
import type { RfiFormValues } from "./schema";

export interface RfisScreenProps {
  contractId: string;
  roles: AppRole[];
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

export function RfisScreen({ contractId, roles, noPermission }: RfisScreenProps) {
  const contractQuery = useContract(contractId);
  const rfisQuery = useRfis(contractId);
  const online = useOnlineStatus();
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetApiError, setSheetApiError] = useState<string | undefined>(undefined);

  let state: RfisScreenState;
  if (!online && (contractQuery.data || rfisQuery.data)) {
    state = "offline";
  } else if (contractQuery.isLoading || rfisQuery.isLoading) {
    state = "loading";
  } else if (contractQuery.error) {
    state = contractQuery.error instanceof ApiError && contractQuery.error.status === 404 ? "noPermission" : "error";
  } else if (rfisQuery.error) {
    state = "error";
  } else if ((rfisQuery.data?.length ?? 0) === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  function selectRow(id: string | "new" | null) {
    setSheetApiError(undefined);
    setSelectedId(id);
  }

  async function refetchAll(): Promise<void> {
    await Promise.all([contractQuery.refetch(), rfisQuery.refetch()]);
  }

  async function handleCreate(values: RfiFormValues): Promise<void> {
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<Rfi>(`/contracts/${encodeURIComponent(contractId)}/rfis`, "POST", values, RfiSchema);
      setSelectedId(null);
      await refetchAll();
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSheetSaving(false);
    }
  }

  async function handleAnswer(answerEl: string): Promise<void> {
    if (!selectedId || selectedId === "new") return;
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<Rfi>(
        `/contracts/${encodeURIComponent(contractId)}/rfis/${encodeURIComponent(selectedId)}/answer`,
        "POST",
        { answerEl },
        RfiSchema,
      );
      await refetchAll();
      // Stay on the row: it now shows the answer and the «Ολοκλήρωση» button.
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSheetSaving(false);
    }
  }

  async function handleClose(): Promise<void> {
    if (!selectedId || selectedId === "new") return;
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<Rfi>(`/contracts/${encodeURIComponent(contractId)}/rfis/${encodeURIComponent(selectedId)}/close`, "POST", undefined, RfiSchema);
      setSelectedId(null);
      await refetchAll();
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSheetSaving(false);
    }
  }

  return (
    <Rfis
      contract={contractQuery.data}
      rfis={rfisQuery.data}
      state={state}
      onRetry={() => void refetchAll()}
      noPermission={noPermission}
      roles={roles}
      selectedId={selectedId}
      onSelect={selectRow}
      sheetSaving={sheetSaving}
      sheetApiError={sheetApiError}
      onCreate={(values) => void handleCreate(values)}
      onAnswer={(answerEl) => void handleAnswer(answerEl)}
      onCloseRfi={() => void handleClose()}
    />
  );
}
