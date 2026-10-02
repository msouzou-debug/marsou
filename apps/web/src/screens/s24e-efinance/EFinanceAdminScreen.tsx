"use client";

// S24e — ADR-0029
//
/**
 * EFinanceAdminScreen — the network-aware wrapper around `EFinanceAdmin`. Owns
 * the two writes, `POST /admin/efinance/sync` and `POST /admin/efinance/sync-master`,
 * and keeps the answer of the last run of each so the card can show it.
 */
import { useEffect, useState } from "react";
import { EFinanceMasterSyncResult, EFinanceSyncResult } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { EFinanceAdmin } from "./EFinanceAdmin";

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

export function EFinanceAdminScreen() {
  const online = useOnlineStatus();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<EFinanceSyncResult | undefined>(undefined);
  const [syncError, setSyncError] = useState<string | undefined>(undefined);
  const [syncingMaster, setSyncingMaster] = useState(false);
  const [masterResult, setMasterResult] = useState<EFinanceMasterSyncResult | undefined>(undefined);
  const [masterError, setMasterError] = useState<string | undefined>(undefined);

  async function runSync(): Promise<void> {
    setSyncing(true);
    setSyncError(undefined);
    try {
      setSyncResult(await apiMutate("/admin/efinance/sync", "POST", undefined, EFinanceSyncResult));
    } catch (error) {
      setSyncError(error instanceof ApiError ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  }

  async function runMaster(): Promise<void> {
    setSyncingMaster(true);
    setMasterError(undefined);
    try {
      setMasterResult(await apiMutate("/admin/efinance/sync-master", "POST", undefined, EFinanceMasterSyncResult));
    } catch (error) {
      setMasterError(error instanceof ApiError ? error.message : String(error));
    } finally {
      setSyncingMaster(false);
    }
  }

  return (
    <EFinanceAdmin
      syncResult={syncResult}
      syncError={syncError}
      syncing={syncing}
      onSync={() => void runSync()}
      masterResult={masterResult}
      masterError={masterError}
      syncingMaster={syncingMaster}
      onSyncMaster={() => void runMaster()}
      offline={!online}
    />
  );
}
