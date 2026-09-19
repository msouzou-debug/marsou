"use client";

// S08 — R10 (ADR-0015)
//
/**
 * VariationsScreen — the network-aware wrapper around `Variations` (same
 * Screen/pure split as S07's own pair). Reuses `useContract(contractId)` —
 * the same query key S07 reads — since `ContractDetail` already carries the
 * full variations list, `contractNo` and `currentValue`; this screen never
 * needs a second endpoint.
 *
 * Owns every mutation: create (`POST .../variations`), edit
 * (`PATCH .../variations/:vid`), submit (`POST .../submit`) and decide
 * (`POST .../decide`). Every one refetches the contract and closes the
 * sheet on success, the same "refresh from the one call that has everything"
 * pattern `ProjectOverviewScreen`'s phase dialog uses.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole, Variation, VariationDecision as VariationDecisionType } from "@ecapital/shared";
import { Variation as VariationSchema } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useContract } from "@/data/queries";
import type { VariationFormValues } from "./schema";
import { Variations, type VariationsScreenState } from "./Variations";

export interface VariationsScreenProps {
  contractId: string;
  roles: AppRole[];
  meUserId: string;
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

export function VariationsScreen({ contractId, roles, meUserId, noPermission }: VariationsScreenProps) {
  const { data, error, isLoading, refetch } = useContract(contractId);
  const online = useOnlineStatus();
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetApiError, setSheetApiError] = useState<string | undefined>(undefined);

  let state: VariationsScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  } else if (data && data.variations.length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  function selectRow(id: string | "new" | null) {
    setSheetApiError(undefined);
    setSelectedId(id);
  }

  async function handleSave(values: VariationFormValues): Promise<void> {
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      if (selectedId === "new") {
        await apiMutate<Variation>(`/contracts/${encodeURIComponent(contractId)}/variations`, "POST", values, VariationSchema);
      } else if (selectedId) {
        await apiMutate<Variation>(
          `/contracts/${encodeURIComponent(contractId)}/variations/${encodeURIComponent(selectedId)}`,
          "PATCH",
          values,
          VariationSchema,
        );
      }
      setSelectedId(null);
      await refetch();
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSheetSaving(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!selectedId || selectedId === "new") return;
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<Variation>(
        `/contracts/${encodeURIComponent(contractId)}/variations/${encodeURIComponent(selectedId)}/submit`,
        "POST",
        undefined,
        VariationSchema,
      );
      setSelectedId(null);
      await refetch();
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSheetSaving(false);
    }
  }

  async function handleDecide(decision: VariationDecisionType["decision"], comment: string | null): Promise<void> {
    if (!selectedId || selectedId === "new") return;
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<Variation>(
        `/contracts/${encodeURIComponent(contractId)}/variations/${encodeURIComponent(selectedId)}/decide`,
        "POST",
        { decision, commentEl: comment },
        VariationSchema,
      );
      setSelectedId(null);
      await refetch();
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSheetSaving(false);
    }
  }

  return (
    <Variations
      data={data}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      meUserId={meUserId}
      selectedId={selectedId}
      onSelect={selectRow}
      sheetSaving={sheetSaving}
      sheetApiError={sheetApiError}
      onSave={(values) => void handleSave(values)}
      onSubmit={() => void handleSubmit()}
      onDecide={(decision, comment) => void handleDecide(decision, comment)}
    />
  );
}
