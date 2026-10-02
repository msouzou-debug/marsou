"use client";

// S07g — ADR-0029
//
/**
 * EFinanceRequisitionsScreen — the network-aware wrapper around `EFinanceRequisitions`.
 * Reads the contract (`useContract`, for the eyebrow and the tab strip) and
 * the contract's eFinance requisitions side by side. Read only: no mutation here.
 *
 * | Prop         | Type       | Notes                                |
 * |--------------|------------|---------------------------------------|
 * | contractId   | string     | The `[id]` route segment.              |
 * | noPermission | ReactNode  | The shell's `NoPermission`.            |
 */
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/data/client";
import { useContract, useContractEfinanceRequisitions } from "@/data/queries";
import { EFinanceRequisitions, type EFinanceRequisitionsState } from "./EFinanceRequisitions";

export interface EFinanceRequisitionsScreenProps {
  contractId: string;
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

export function EFinanceRequisitionsScreen({ contractId, noPermission }: EFinanceRequisitionsScreenProps) {
  const contractQuery = useContract(contractId);
  const requisitionsQuery = useContractEfinanceRequisitions(contractId);
  const online = useOnlineStatus();

  let state: EFinanceRequisitionsState;
  if (!online && (contractQuery.data || requisitionsQuery.data)) {
    state = "offline";
  } else if (contractQuery.isLoading || requisitionsQuery.isLoading) {
    state = "loading";
  } else if (contractQuery.error) {
    state = contractQuery.error instanceof ApiError && contractQuery.error.status === 404 ? "noPermission" : "error";
  } else if (requisitionsQuery.error) {
    state = requisitionsQuery.error instanceof ApiError && requisitionsQuery.error.status === 404 ? "noPermission" : "error";
  } else if ((requisitionsQuery.data?.items.length ?? 0) === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  return (
    <EFinanceRequisitions
      contract={contractQuery.data}
      list={requisitionsQuery.data}
      state={state}
      onRetry={() => void Promise.all([contractQuery.refetch(), requisitionsQuery.refetch()])}
      noPermission={noPermission}
    />
  );
}
