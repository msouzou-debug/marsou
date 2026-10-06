"use client";

// S19 «Εκτέλεση εντολής» — R33, R34
//
// WorkOrderRunScreen — the network-aware wrapper around `WorkOrderRun`. The
// same order query and writes as S18a (`useWorkOrderWrites`), so a step taken
// on the phone and one taken at a desk are the same call.
import type { ReactNode } from "react";
import type { AppRole, OrgUnit } from "@ecapital/shared";
import { useLocale } from "next-intl";
import { canWorkWorkOrder } from "@/auth/roles";
import { ApiError } from "@/data/client";
import { useWorkOrder } from "@/data/queries";
import { useOnlineStatus } from "@/screens/s18-work-orders/useOnlineStatus";
import { useWorkOrderWrites } from "@/screens/s18a-work-order/WorkOrderDetailScreen";
import { WorkOrderRun, type WorkOrderRunState } from "./WorkOrderRun";

export interface WorkOrderRunScreenProps {
  workOrderId: string;
  roles: AppRole[];
  orgUnits: OrgUnit[];
  noPermission: ReactNode;
}

export function WorkOrderRunScreen({ workOrderId, roles, orgUnits, noPermission }: WorkOrderRunScreenProps) {
  const locale = useLocale();
  const { data, error, isLoading, refetch } = useWorkOrder(workOrderId);
  const online = useOnlineStatus();
  const writes = useWorkOrderWrites(workOrderId, refetch);

  let state: WorkOrderRunState;
  if (!online && data) state = "offline";
  else if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && (error.status === 403 || error.status === 404) ? "noPermission" : "error";
  else state = "default";

  const unit = orgUnits.find((u) => u.id === data?.orgUnitId);
  const unitName = unit ? (locale === "en" ? unit.nameEn : unit.nameEl) : undefined;

  return (
    <WorkOrderRun
      order={data}
      state={state}
      unitName={unitName}
      canWork={canWorkWorkOrder(roles)}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      onTransition={writes.transition}
      onUpload={writes.upload}
    />
  );
}
