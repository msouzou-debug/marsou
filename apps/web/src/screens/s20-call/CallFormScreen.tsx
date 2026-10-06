"use client";

// S20 «Καταγραφή κλήσης» — R33
//
// CallFormScreen — owns the unit and the reads that hang off it, posts the
// call and opens the new order (S18a). Same split as S17a's form screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { AppRole, OrgUnit, WorkOrderCreate } from "@ecapital/shared";
import { useQueryClient } from "@tanstack/react-query";
import { canRaiseWorkOrder } from "@/auth/roles";
import { ApiError, apiMutate } from "@/data/client";
import { useAreaTree, useAssetsForUnit, useMaintenanceContracts, useSlaSystems } from "@/data/queries";
import { CallForm } from "./CallForm";

export interface CallFormScreenProps {
  orgUnits: OrgUnit[];
  roles: AppRole[];
  defaultOrgUnitId?: string;
}

const Created = z.object({ id: z.string() });

export function CallFormScreen({ orgUnits, roles, defaultOrgUnitId }: CallFormScreenProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [unitId, setUnitId] = useState(() =>
    defaultOrgUnitId && orgUnits.some((u) => u.id === defaultOrgUnitId) ? defaultOrgUnitId : orgUnits.length === 1 ? orgUnits[0].id : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const assets = useAssetsForUnit(unitId);
  const agreements = useMaintenanceContracts(unitId || undefined);
  // RULE (ADR-0031 §1): one umbrella agreement per unit; the ACTIVE one sets the timers.
  const agreement = unitId ? (agreements.data ? (agreements.data.find((c) => c.orgUnitId === unitId && c.status === "ACTIVE") ?? null) : undefined) : undefined;
  const systems = useSlaSystems(agreement?.id ?? "");
  const areaTree = useAreaTree(unitId);

  // RULE (owner answer 06/10/2026): the nursing team alerts the vendor on
  // site; a clinical approver raising a call is the nursing side.
  const defaultSource = roles.includes("clinical_approver") ? "NURSING" : "TECHNICAL_SERVICES";

  async function submit(body: WorkOrderCreate) {
    setSubmitting(true);
    setError(undefined);
    try {
      const created = await apiMutate("/work-orders", "POST", body, Created);
      void queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
      router.push(`/maintenance/${encodeURIComponent(created.id)}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <CallForm
      orgUnits={orgUnits}
      unitId={unitId}
      onUnitChange={setUnitId}
      assets={assets.data}
      agreement={agreement}
      systems={systems.data}
      areaTree={areaTree.data}
      defaultSource={defaultSource}
      readOnly={!canRaiseWorkOrder(roles)}
      submitting={submitting}
      error={error}
      onSubmit={(body) => void submit(body)}
      onCancel={() => router.push("/maintenance")}
    />
  );
}
