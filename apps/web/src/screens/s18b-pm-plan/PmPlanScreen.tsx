"use client";

// S18b «Προληπτική συντήρηση» — R32
//
// PmPlanScreen — owns the unit, the five reads (agreements, catalogue,
// schedules, the unit's assets, the contractor register) and the six writes,
// each through the same-origin proxy, then invalidates what it changed.
import { useState, type ReactNode } from "react";
import { z } from "zod";
import {
  PmGenerationResult,
  SlaImportResult,
  type AppRole,
  type MaintenanceContractWrite,
  type OrgUnit,
  type PmScheduleWrite,
  type SlaSystemWrite,
} from "@ecapital/shared";
import { useQueryClient } from "@tanstack/react-query";
import { canManageMaintenanceContract } from "@/auth/roles";
import type { TableState } from "@/components/table";
import { ApiError, apiMutate, apiMutateMultipart } from "@/data/client";
import { useAssetsForUnit, useContractors, useMaintenanceContracts, usePmSchedules, useSlaSystems } from "@/data/queries";
import { useOnlineStatus } from "@/screens/s18-work-orders/useOnlineStatus";
import { PmPlan, type PmPlanState } from "./PmPlan";

export interface PmPlanScreenProps {
  orgUnits: OrgUnit[];
  roles: AppRole[];
  defaultOrgUnitId?: string;
  noPermission: ReactNode;
}

function tableState(q: { isLoading: boolean; error: unknown; data?: unknown[] }, offline: boolean): TableState {
  if (offline && q.data) return "offline";
  if (q.isLoading) return "loading";
  if (q.error) return q.error instanceof ApiError && q.error.status === 403 ? "noPermission" : "error";
  if (!q.data || q.data.length === 0) return "empty";
  return "default";
}

export function PmPlanScreen({ orgUnits, roles, defaultOrgUnitId, noPermission }: PmPlanScreenProps) {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const [unitId, setUnitId] = useState(() =>
    defaultOrgUnitId && orgUnits.some((u) => u.id === defaultOrgUnitId) ? defaultOrgUnitId : orgUnits.length === 1 ? orgUnits[0].id : "",
  );
  const canManage = canManageMaintenanceContract(roles);

  const agreements = useMaintenanceContracts(unitId || undefined);
  const forUnit = (agreements.data ?? []).filter((a) => a.orgUnitId === unitId);
  // RULE (ADR-0031 §1): the ACTIVE agreement is the one the timers use; an
  // ended one still shows when it is all the unit has.
  const agreement = forUnit.find((a) => a.status === "ACTIVE") ?? forUnit[0] ?? null;
  const systems = useSlaSystems(agreement?.id ?? "");
  const schedules = usePmSchedules({ orgUnitId: unitId || undefined, maintenanceContractId: agreement?.id });
  const assets = useAssetsForUnit(unitId);
  const contractors = useContractors();

  let state: PmPlanState;
  if (!online && agreements.data) state = "offline";
  else if (agreements.isLoading) state = "loading";
  else if (agreements.error) state = agreements.error instanceof ApiError && agreements.error.status === 403 ? "noPermission" : "error";
  else state = "default";

  const invalidate = (key: string) => queryClient.invalidateQueries({ queryKey: [key] });

  return (
    <PmPlan
      orgUnits={orgUnits}
      unitId={unitId}
      onUnitChange={setUnitId}
      state={state}
      onRetry={() => {
        void agreements.refetch();
        void systems.refetch();
        void schedules.refetch();
      }}
      noPermission={noPermission}
      agreement={agreement}
      contractors={contractors.data ?? []}
      systems={systems.data}
      systemsState={tableState(systems, !online)}
      schedules={schedules.data}
      schedulesState={agreement ? tableState(schedules, !online) : "empty"}
      assets={assets.data ?? []}
      canManage={canManage}
      onSaveAgreement={async (write: MaintenanceContractWrite, id?: string) => {
        if (id) await apiMutate(`/maintenance/contracts/${encodeURIComponent(id)}`, "PATCH", write, z.unknown());
        else await apiMutate("/maintenance/contracts", "POST", write, z.unknown());
        await invalidate("maintenance-contracts");
      }}
      onPatchSystem={async (id: string, patch: Partial<SlaSystemWrite>) => {
        await apiMutate(`/maintenance/systems/${encodeURIComponent(id)}`, "PATCH", patch, z.unknown());
        await invalidate("sla-systems");
      }}
      onImport={async (file: File) => {
        const form = new FormData();
        form.set("file", file);
        const result = await apiMutateMultipart(`/maintenance/contracts/${encodeURIComponent(agreement?.id ?? "")}/systems/import`, form, SlaImportResult);
        await invalidate("sla-systems");
        void invalidate("maintenance-contracts");
        return result;
      }}
      onSaveSchedule={async (write: PmScheduleWrite, id?: string) => {
        if (id) await apiMutate(`/maintenance/schedules/${encodeURIComponent(id)}`, "PATCH", write, z.unknown());
        else await apiMutate("/maintenance/schedules", "POST", write, z.unknown());
        await invalidate("pm-schedules");
      }}
      onGenerate={async () => {
        const result = await apiMutate("/maintenance/schedules/generate", "POST", {}, PmGenerationResult);
        await invalidate("pm-schedules");
        void invalidate("work-orders");
        void invalidate("maintenance-summary");
        return result;
      }}
    />
  );
}
