"use client";

// S07i — ADR-0035
//
/**
 * ClaimsScreen — the network-aware wrapper around `Claims`. Reads
 * `useContract` (the detail carries `claims`) and owns `POST
 * /contracts/:id/claims` and `PATCH /contracts/:id/claims/:cid`, both of
 * which answer with the whole `ContractDetail`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ContractDetail as ContractDetailSchema, type AppRole, type ContractClaimWrite } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useContract } from "@/data/queries";
import { Claims, type ClaimsScreenState } from "./Claims";
import type { ClaimFormValues } from "./schema";

export interface ClaimsScreenProps {
  contractId: string;
  roles: AppRole[];
  noPermission: ReactNode;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function ClaimsScreen({ contractId, roles, noPermission }: ClaimsScreenProps) {
  const { data, error, isLoading, refetch } = useContract(contractId);
  const online = useOnlineStatus();
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  let state: ClaimsScreenState;
  if (!online && data) state = "offline";
  else if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  else state = "default";

  async function save(claimId: string | null, values: ClaimFormValues): Promise<boolean> {
    const body: ContractClaimWrite = {
      direction: values.direction,
      titleEl: values.titleEl.trim(),
      amount: values.amount,
      stage: values.stage,
      notifiedAt: values.notifiedAt === "" ? null : values.notifiedAt,
      legalAdvisorEl: values.legalAdvisorEl.trim() === "" ? null : values.legalAdvisorEl.trim(),
      contingentLiability: values.contingentLiability,
      notesEl: values.notesEl,
    };
    const base = `/contracts/${encodeURIComponent(contractId)}/claims`;
    setSaving(true);
    setApiError(undefined);
    try {
      if (claimId) await apiMutate(`${base}/${encodeURIComponent(claimId)}`, "PATCH", body, ContractDetailSchema);
      else await apiMutate(base, "POST", body, ContractDetailSchema);
      await refetch();
      return true;
    } catch (submitError) {
      setApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <Claims
      data={data}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      saving={saving}
      apiError={apiError}
      onClearError={() => setApiError(undefined)}
      onSave={save}
    />
  );
}
