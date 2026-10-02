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
import { BoqItem as BoqItemSchema, EFinanceContractStatus } from "@ecapital/shared";
import { z } from "zod";
import { ApiError, apiMutate } from "@/data/client";
import { useConfigLinks, useContract } from "@/data/queries";
import type { BoqDraftRow } from "./BoqSection";
import { ContractOverview, type ContractOverviewScreenState } from "./ContractOverview";
import type { EFinancePushResult } from "./EFinancePanel";

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
  // ADR-0019 §4. Its own query, cached for the session: whether the link-outs
  // appear must not hold up the contract itself, and a failure here means no
  // links rather than no page.
  const { data: links } = useConfigLinks();
  const online = useOnlineStatus();

  const [boqSaving, setBoqSaving] = useState(false);
  const [boqError, setBoqError] = useState<string | undefined>(undefined);

  const [efinancePushing, setEfinancePushing] = useState(false);
  const [efinancePushResult, setEfinancePushResult] = useState<EFinancePushResult | undefined>(undefined);

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

  // ADR-0029: the administrator's "send again". The answer is the state after
  // the attempt: a refusal from eFinance is in `lastError`, not an error
  // response, because the attempt itself worked; an unpushable contract is a
  // 422 whose message is already a sentence in the caller's language.
  async function pushEfinance(): Promise<void> {
    setEfinancePushing(true);
    setEfinancePushResult(undefined);
    try {
      const status = await apiMutate<EFinanceContractStatus>(
        `/contracts/${encodeURIComponent(contractId)}/efinance/push`,
        "POST",
        undefined,
        EFinanceContractStatus,
      );
      setEfinancePushResult(status.lastError ? { ok: false, message: status.lastError } : { ok: true });
      // The warnings strip and the panel both read the contract.
      await refetch();
    } catch (pushError) {
      setEfinancePushResult({ ok: false, message: pushError instanceof ApiError ? pushError.message : String(pushError) });
    } finally {
      setEfinancePushing(false);
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
      links={links}
      onPushEfinance={() => void pushEfinance()}
      efinancePushing={efinancePushing}
      efinancePushResult={efinancePushResult}
    />
  );
}
