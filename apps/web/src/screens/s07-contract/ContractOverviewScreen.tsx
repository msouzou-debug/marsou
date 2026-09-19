"use client";

// S07 — R08, R10, R31
//
/**
 * ContractOverviewScreen — the network-aware wrapper around `ContractOverview`
 * (same Screen/pure split as S03's own `ProjectOverviewScreen`/`ProjectOverview`
 * pair). The only place that calls `useContract()` and `PUT /contracts/:id/boq`.
 *
 * Resolves loading/error/noPermission/offline from the query and
 * `navigator.onLine`, the same rules S03 uses (ADR-0010: the API's 404
 * covers "no such contract" and "not yours" alike, so this never tries to
 * tell them apart).
 *
 * | Prop         | Type       | Notes                                             |
 * |--------------|------------|----------------------------------------------------|
 * | contractId   | string     | The `[id]` route segment.                           |
 * | roles        | AppRole[]  | `me.roles` — the «Επεξεργασία» gate.                |
 * | noPermission | ReactNode  | The shell's `NoPermission`, resolved by the caller. |
 */
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole, BoqItem } from "@ecapital/shared";
import { BoqItem as BoqItemSchema } from "@ecapital/shared";
import { z } from "zod";
import { ApiError, apiMutate } from "@/data/client";
import { useContract } from "@/data/queries";
import type { BoqDraftRow } from "./BoqSection";
import { ContractOverview, type ContractOverviewScreenState } from "./ContractOverview";

export interface ContractOverviewScreenProps {
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

export function ContractOverviewScreen({ contractId, roles, noPermission }: ContractOverviewScreenProps) {
  const { data, error, isLoading, refetch } = useContract(contractId);
  const online = useOnlineStatus();

  const [boqSaving, setBoqSaving] = useState(false);
  const [boqError, setBoqError] = useState<string | undefined>(undefined);

  let state: ContractOverviewScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  } else {
    state = "default";
  }

  async function saveBoq(rows: BoqDraftRow[]): Promise<void> {
    setBoqSaving(true);
    setBoqError(undefined);
    try {
      const body = rows.map((row) => ({
        itemNo: row.itemNo,
        descriptionEl: row.descriptionEl,
        unit: row.unit,
        qty: Number(row.qty),
        rate: Number(row.rate),
      }));
      await apiMutate<BoqItem[]>(
        `/contracts/${encodeURIComponent(contractId)}/boq`,
        "PUT",
        body,
        z.array(BoqItemSchema),
      );
      await refetch();
    } catch (submitError) {
      setBoqError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setBoqSaving(false);
    }
  }

  return (
    <ContractOverview
      data={data}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      onSaveBoq={(rows) => void saveBoq(rows)}
      boqSaving={boqSaving}
      boqError={boqError}
    />
  );
}
