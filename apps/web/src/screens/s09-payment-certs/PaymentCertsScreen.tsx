"use client";

// S09 — R11
//
/**
 * PaymentCertsScreen — the network-aware wrapper around `PaymentCerts`. Owns
 * `usePaymentCerts()` for the list and `useContract()` only for the header
 * (contract number, the tab strip's own counts) — never blocking on the
 * contract query, same reasoning `ContractOverviewScreen` gives
 * `useConfigLinks`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AppRole, PaymentCert } from "@ecapital/shared";
import { ApiError } from "@/data/client";
import { useContract, usePaymentCerts } from "@/data/queries";
import { PaymentCerts, type PaymentCertsScreenState } from "./PaymentCerts";

export interface PaymentCertsScreenProps {
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

export function PaymentCertsScreen({ contractId, roles, noPermission }: PaymentCertsScreenProps) {
  const router = useRouter();
  const { data, error, isLoading, refetch } = usePaymentCerts(contractId);
  const contract = useContract(contractId);
  const online = useOnlineStatus();

  let state: PaymentCertsScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  } else if ((data ?? []).length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  return (
    <PaymentCerts
      data={data}
      contractId={contractId}
      contractNo={contract.data?.contractNo}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      onAdd={() => router.push(`/contracts/${encodeURIComponent(contractId)}/certificates/new`)}
      onRowOpen={(cert: PaymentCert) => router.push(`/certificates/${encodeURIComponent(cert.id)}`)}
      rfisOpenCount={contract.data?.rfisOpen}
      defectsOpenCount={contract.data?.defects?.filter((d) => d.status !== "CLOSED").length}
    />
  );
}
