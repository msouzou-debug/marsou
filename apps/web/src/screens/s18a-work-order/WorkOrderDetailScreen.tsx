"use client";

// S18a «Εντολή εργασίας» — R33, R34, R35
//
// WorkOrderDetailScreen — the network-aware wrapper around `WorkOrderDetail`.
// Owns `useWorkOrder` and the five writes the record page makes, each
// through the same-origin proxy (ADR-0013), then refetches the order so the
// timers, the status and the history come back from the API, never from a
// guess here. S19 reuses `useWorkOrderWrites` for its own buttons.
import type { ReactNode } from "react";
import { z } from "zod";
import { BacklogItem, WorkOrderEvent, type AppRole, type BacklogCreate, type WorkOrderPatch, type WorkOrderTransition } from "@ecapital/shared";
import { useQueryClient } from "@tanstack/react-query";
import { canManageBacklog, canWorkWorkOrder } from "@/auth/roles";
import { ApiError, apiMutate, apiMutateMultipart } from "@/data/client";
import { useWorkOrder } from "@/data/queries";
import { useOnlineStatus } from "@/screens/s18-work-orders/useOnlineStatus";
import { WorkOrderDetail, type WorkOrderDetailState } from "./WorkOrderDetail";

export interface WorkOrderDetailScreenProps {
  workOrderId: string;
  roles: AppRole[];
  noPermission: ReactNode;
}

/** The five writes S18a and S19 make on one order. Each refetches on success. */
export function useWorkOrderWrites(workOrderId: string, refetch: () => Promise<unknown>) {
  const queryClient = useQueryClient();
  const base = `/work-orders/${encodeURIComponent(workOrderId)}`;
  async function after() {
    await refetch();
    // The list and the tiles count this order too.
    void queryClient.invalidateQueries({ queryKey: ["work-orders"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
  }
  return {
    async transition(body: WorkOrderTransition) {
      // The order is read back below, so the response body is not needed here.
      await apiMutate(`${base}/transition`, "POST", body, z.unknown());
      await after();
    },
    async patch(patch: WorkOrderPatch) {
      await apiMutate(base, "PATCH", patch, z.unknown());
      await after();
    },
    async note(noteEl: string) {
      await apiMutate(`${base}/notes`, "POST", { noteEl }, z.unknown());
      await after();
    },
    async upload(file: File, titleEl: string) {
      const form = new FormData();
      form.set("file", file);
      if (titleEl) form.set("titleEl", titleEl);
      await apiMutateMultipart(`${base}/documents`, form, WorkOrderEvent);
      await after();
    },
    async toBacklog(body: BacklogCreate) {
      await apiMutate(`${base}/backlog`, "POST", body, BacklogItem);
      void queryClient.invalidateQueries({ queryKey: ["backlog"] });
      await after();
    },
  };
}

export function WorkOrderDetailScreen({ workOrderId, roles, noPermission }: WorkOrderDetailScreenProps) {
  const { data, error, isLoading, refetch } = useWorkOrder(workOrderId);
  const online = useOnlineStatus();
  const writes = useWorkOrderWrites(workOrderId, refetch);

  let state: WorkOrderDetailState;
  if (!online && data) state = "offline";
  else if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && (error.status === 403 || error.status === 404) ? "noPermission" : "error";
  else state = "default";

  return (
    <WorkOrderDetail
      order={data}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      canWork={canWorkWorkOrder(roles)}
      canManageBacklog={canManageBacklog(roles)}
      onTransition={writes.transition}
      onPatch={writes.patch}
      onNote={writes.note}
      onUpload={writes.upload}
      onToBacklog={writes.toBacklog}
    />
  );
}
