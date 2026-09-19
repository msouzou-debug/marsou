"use client";

// S24 — R08
//
// ContractorsScreen — the network-aware wrapper around `Contractors`. Owns
// `useContractors()` and the create/update mutations
// (`POST /contractors`, `PATCH /contractors/:id`).
import { useEffect, useState, type ReactNode } from "react";
import type { Contractor } from "@ecapital/shared";
import { Contractor as ContractorSchema } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useContractors } from "@/data/queries";
import type { ContractorFormValues } from "./schema";
import { Contractors, type ContractorsScreenState } from "./Contractors";

export interface ContractorsScreenProps {
  isAdmin: boolean;
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

export function ContractorsScreen({ isAdmin, noPermission }: ContractorsScreenProps) {
  const { data, error, isLoading, refetch } = useContractors();
  const online = useOnlineStatus();
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  let state: ContractorsScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  } else if (data && data.length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  function selectRow(id: string | "new" | null) {
    setApiError(undefined);
    setSelectedId(id);
  }

  async function handleSave(values: ContractorFormValues, blacklisted?: boolean): Promise<void> {
    setSaving(true);
    setApiError(undefined);
    try {
      if (selectedId === "new") {
        await apiMutate<Contractor>("/contractors", "POST", values, ContractorSchema);
      } else if (selectedId) {
        const body = blacklisted === undefined ? values : { ...values, blacklisted };
        await apiMutate<Contractor>(`/contractors/${encodeURIComponent(selectedId)}`, "PATCH", body, ContractorSchema);
      }
      setSelectedId(null);
      await refetch();
    } catch (submitError) {
      setApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Contractors
      data={data}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      isAdmin={isAdmin}
      selectedId={selectedId}
      onSelect={selectRow}
      sheetSaving={saving}
      sheetApiError={apiError}
      onSave={(values, blacklisted) => void handleSave(values, blacklisted)}
    />
  );
}
