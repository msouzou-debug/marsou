"use client";

// S10 — R14
//
/**
 * UnmatchedQueueScreen — the network-aware wrapper around `UnmatchedQueue`.
 * Owns `useImportBatch`/`useUnmatchedQueue` and every write S10's batch page
 * makes: `POST .../allocate`, `POST .../skip`, `POST .../commit`.
 *
 * RULE (build brief §5 S10): "accepting moves focus to the next row
 * immediately, no confirmation … using the `next` row from the response".
 * `allocate` optimistically drops the accepted row from the local queue
 * state and keeps focus at the same index (the row that slides into it),
 * rather than waiting for a refetch — a refetch still happens in the
 * background is unnecessary here since the API's own response already
 * carries `remaining`/`next`, so this patches the cached queue directly.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AppRole } from "@ecapital/shared";
import { Allocation, ProjectListQuery, UnmatchedQueue as UnmatchedQueueSchema } from "@ecapital/shared";
import { z } from "zod";
import { ApiError, apiMutate } from "@/data/client";
import { useImportBatch, useProjectContracts, useProjects, useUnmatchedQueue } from "@/data/queries";
import { UnmatchedQueue, type UnmatchedQueueScreenState } from "./UnmatchedQueue";

export interface UnmatchedQueueScreenProps {
  batchId: string;
  roles: AppRole[];
  noPermission: ReactNode;
}

const AllocateResponse = z.object({
  remaining: z.number().int(),
  next: UnmatchedQueueSchema.shape.items.element.nullable(),
});

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

export function UnmatchedQueueScreen({ batchId, roles, noPermission }: UnmatchedQueueScreenProps) {
  const router = useRouter();
  const batch = useImportBatch(batchId);
  const { data, error, isLoading, refetch } = useUnmatchedQueue(batchId);
  const online = useOnlineStatus();

  // Local, patchable copy of the queue's items — see the header comment for
  // why this is not just `data` re-rendered on every accept/skip. Re-derived
  // whenever a *new* server queue arrives — adjusted during render (React's
  // own recommended pattern for resetting state on a prop change, the same
  // one `ConfirmDialog`'s `wasOpen` and `BudgetLinesEditor`'s `prevSignature`
  // use) rather than in an effect, which would set state a render late.
  const [items, setItems] = useState(data?.items ?? []);
  const [remaining, setRemaining] = useState(data?.remaining ?? 0);
  const [syncedData, setSyncedData] = useState(data);
  if (data && data !== syncedData) {
    setSyncedData(data);
    setItems(data.items);
    setRemaining(data.remaining);
  }

  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkAssignApiError, setBulkAssignApiError] = useState<string | undefined>(undefined);
  const [bulkAssignSearch, setBulkAssignSearch] = useState("");
  const [bulkAssignProjectId, setBulkAssignProjectId] = useState<string | null>(null);
  const [bulkAssignContractId, setBulkAssignContractId] = useState<string | null>(null);
  // RULE (`ContractsCard`'s own header comment): these two queries live only
  // here, in the network wrapper — `BulkAssignPicker` and `UnmatchedQueue`
  // stay pure, so their own unit tests never need a `QueryClientProvider`.
  const bulkAssignProjects = useProjects(ProjectListQuery.parse({ q: bulkAssignSearch, pageSize: 20 }));
  const bulkAssignContracts = useProjectContracts(bulkAssignProjectId ?? "");

  let state: UnmatchedQueueScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && (error.status === 404 || error.status === 403) ? "noPermission" : "error";
  } else if (items.length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  function moveFocus(direction: 1 | -1) {
    setFocusedIndex((index) => Math.max(0, Math.min(items.length - 1, index + direction)));
  }

  function removeTxn(txnId: string) {
    setItems((rows) => rows.filter((row) => row.txn.id !== txnId));
    setSelectedIds((ids) => {
      const next = new Set(ids);
      next.delete(txnId);
      return next;
    });
    setFocusedIndex((index) => Math.max(0, Math.min(items.length - 2, index)));
  }

  async function accept(txnId: string, suggestionIndex: number): Promise<void> {
    const row = items.find((r) => r.txn.id === txnId);
    const suggestion = row?.suggestions[suggestionIndex];
    if (!suggestion) return;
    const body: Allocation = { txnIds: [txnId], projectId: suggestion.projectId, contractId: suggestion.contractId, remember: true };
    try {
      const result = await apiMutate(
        `/cost/imports/${encodeURIComponent(batchId)}/allocate`,
        "POST",
        body,
        AllocateResponse,
      );
      setRemaining(result.remaining);
      removeTxn(txnId);
    } catch {
      // A failed allocate leaves the row in place — the caller can retry the
      // same key; there is nothing else to surface here per row (the queue
      // has no per-row error slot, only the screen's own retry/offline states).
    }
  }

  async function skip(txnIds: string[]): Promise<void> {
    try {
      await apiMutate(`/cost/imports/${encodeURIComponent(batchId)}/skip`, "POST", { txnIds }, z.object({}).passthrough());
      for (const id of txnIds) removeTxn(id);
    } catch {
      /* the row stays in the queue; the caller can retry */
    }
  }

  async function bulkAssign(projectId: string, contractId: string | null): Promise<void> {
    setBulkAssigning(true);
    setBulkAssignApiError(undefined);
    try {
      const txnIds = Array.from(selectedIds);
      const body: Allocation = { txnIds, projectId, contractId, remember: true };
      const result = await apiMutate(
        `/cost/imports/${encodeURIComponent(batchId)}/allocate`,
        "POST",
        body,
        AllocateResponse,
      );
      setRemaining(result.remaining);
      for (const id of txnIds) removeTxn(id);
      closePicker();
    } catch (submitError) {
      setBulkAssignApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setBulkAssigning(false);
    }
  }

  function closePicker(): void {
    setPickerOpen(false);
    setBulkAssignSearch("");
    setBulkAssignProjectId(null);
    setBulkAssignContractId(null);
    setBulkAssignApiError(undefined);
  }

  async function commit(): Promise<void> {
    setCommitting(true);
    try {
      await apiMutate(`/cost/imports/${encodeURIComponent(batchId)}/commit`, "POST", undefined, z.object({}).passthrough());
      router.push("/cost/imports");
    } catch {
      await refetch();
    } finally {
      setCommitting(false);
    }
  }

  const queue = useMemo(
    () => (data ? { ...data, items, remaining } : undefined),
    [data, items, remaining],
  );

  return (
    <UnmatchedQueue
      batch={batch.data}
      queue={queue}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      focusedIndex={Math.min(focusedIndex, Math.max(0, items.length - 1))}
      selectedIds={selectedIds}
      onMoveFocus={moveFocus}
      onAccept={(txnId, index) => void accept(txnId, index)}
      onSkip={(txnIds) => void skip(txnIds)}
      onToggleSelect={(txnId) =>
        setSelectedIds((ids) => {
          const next = new Set(ids);
          if (next.has(txnId)) next.delete(txnId);
          else next.add(txnId);
          return next;
        })
      }
      onCommit={() => void commit()}
      committing={committing}
      pickerOpen={pickerOpen}
      onBulkAssignOpen={() => selectedIds.size > 0 && setPickerOpen(true)}
      onBulkAssignClose={closePicker}
      onBulkAssign={(projectId, contractId) => void bulkAssign(projectId, contractId)}
      bulkAssigning={bulkAssigning}
      bulkAssignApiError={bulkAssignApiError}
      bulkAssignSearch={bulkAssignSearch}
      onBulkAssignSearchChange={setBulkAssignSearch}
      bulkAssignProjectResults={(bulkAssignProjects.data?.items ?? []).map((p) => ({ id: p.id, code: p.code, titleEl: p.titleEl }))}
      bulkAssignProjectId={bulkAssignProjectId}
      onBulkAssignSelectProject={setBulkAssignProjectId}
      bulkAssignContractOptions={(bulkAssignContracts.data?.items ?? []).map((c) => ({ id: c.id, ref: c.ref, contractNo: c.contractNo }))}
      bulkAssignContractId={bulkAssignContractId}
      onBulkAssignSelectContract={setBulkAssignContractId}
    />
  );
}
