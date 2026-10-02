"use client";

// S07f — ADR-0029
//
/**
 * EFinanceInvoicesScreen — the network-aware wrapper around `EFinanceInvoices`.
 * Reads the contract (`useContract`, for the eyebrow and the tab strip) and
 * the contract's eFinance invoices side by side. Read only: no mutation here.
 *
 * | Prop         | Type       | Notes                                |
 * |--------------|------------|---------------------------------------|
 * | contractId   | string     | The `[id]` route segment.              |
 * | noPermission | ReactNode  | The shell's `NoPermission`.            |
 */
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/data/client";
import { useContract, useContractEfinanceInvoices } from "@/data/queries";
import { EFinanceInvoices, type EFinanceInvoicesState } from "./EFinanceInvoices";

export interface EFinanceInvoicesScreenProps {
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

export function EFinanceInvoicesScreen({ contractId, noPermission }: EFinanceInvoicesScreenProps) {
  const contractQuery = useContract(contractId);
  const invoicesQuery = useContractEfinanceInvoices(contractId);
  const online = useOnlineStatus();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  let state: EFinanceInvoicesState;
  if (!online && (contractQuery.data || invoicesQuery.data)) {
    state = "offline";
  } else if (contractQuery.isLoading || invoicesQuery.isLoading) {
    state = "loading";
  } else if (contractQuery.error) {
    state = contractQuery.error instanceof ApiError && contractQuery.error.status === 404 ? "noPermission" : "error";
  } else if (invoicesQuery.error) {
    state = invoicesQuery.error instanceof ApiError && invoicesQuery.error.status === 404 ? "noPermission" : "error";
  } else if ((invoicesQuery.data?.items.length ?? 0) === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  return (
    <EFinanceInvoices
      contract={contractQuery.data}
      list={invoicesQuery.data}
      state={state}
      onRetry={() => void Promise.all([contractQuery.refetch(), invoicesQuery.refetch()])}
      noPermission={noPermission}
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  );
}
