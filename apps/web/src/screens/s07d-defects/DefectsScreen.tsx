"use client";

// S07d — R12, R35 (ADR-0017)
//
// DefectsScreen — the network-aware wrapper around `Defects`. Reads the
// contract (eyebrow, tabs, `orgUnitId`), the contract's own handover defects
// (`GET /defects?contract=`), the unit's area tree (the «Χώρος» column and
// the create form's select) and the unit's own projects (the funded target
// link and select) side by side.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppRole, Defect } from "@ecapital/shared";
import { Defect as DefectSchema } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useAreaTree, useContract, useContractDefects, useProjectsForUnit } from "@/data/queries";
import { Defects, type DefectsScreenState } from "./Defects";
import type { DefectAreaOption, DefectProjectOption } from "./DefectSheet";
import type { DefectCreateFormValues, DefectUpdateFormValues } from "./schema";

export interface DefectsScreenProps {
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

export function DefectsScreen({ contractId, roles, noPermission }: DefectsScreenProps) {
  const contractQuery = useContract(contractId);
  const defectsQuery = useContractDefects(contractId);
  const online = useOnlineStatus();
  const orgUnitId = contractQuery.data?.orgUnitId ?? "";
  const areaTreeQuery = useAreaTree(orgUnitId);
  const projectsQuery = useProjectsForUnit(orgUnitId);

  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetApiError, setSheetApiError] = useState<string | undefined>(undefined);

  let state: DefectsScreenState;
  if (!online && (contractQuery.data || defectsQuery.data)) {
    state = "offline";
  } else if (contractQuery.isLoading || defectsQuery.isLoading) {
    state = "loading";
  } else if (contractQuery.error) {
    state = contractQuery.error instanceof ApiError && contractQuery.error.status === 404 ? "noPermission" : "error";
  } else if (defectsQuery.error) {
    state = "error";
  } else if ((defectsQuery.data?.length ?? 0) === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  const areaOptions = useMemo<DefectAreaOption[]>(() => {
    const tree = areaTreeQuery.data;
    if (!tree) return [];
    return tree.buildings.flatMap((b) => b.floors.flatMap((f) => f.areas.map((a) => ({ id: a.id, nameEl: a.nameEl }))));
  }, [areaTreeQuery.data]);
  const areaNameById = useMemo(() => new Map(areaOptions.map((a) => [a.id, a.nameEl])), [areaOptions]);

  const projectOptions = useMemo<DefectProjectOption[]>(
    () => (projectsQuery.data?.items ?? []).map((p) => ({ id: p.id, code: p.code, titleEl: p.titleEl })),
    [projectsQuery.data],
  );
  const projectById = useMemo(() => new Map(projectOptions.map((p) => [p.id, p])), [projectOptions]);

  function selectRow(id: string | "new" | null) {
    setSheetApiError(undefined);
    setSelectedId(id);
  }

  async function refetchAll(): Promise<void> {
    await Promise.all([contractQuery.refetch(), defectsQuery.refetch()]);
  }

  async function handleCreate(values: DefectCreateFormValues): Promise<void> {
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<Defect>(
        "/defects",
        "POST",
        {
          source: "HANDOVER",
          contractId,
          projectId: null,
          areaId: values.areaId.trim() === "" ? null : values.areaId,
          descriptionEl: values.descriptionEl,
          estimatedCost: Number.isNaN(values.estimatedCost) ? null : values.estimatedCost,
          riskBand: values.riskBand,
        },
        DefectSchema,
      );
      setSelectedId(null);
      await refetchAll();
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSheetSaving(false);
    }
  }

  async function handleUpdate(values: DefectUpdateFormValues): Promise<void> {
    if (!selectedId || selectedId === "new") return;
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<Defect>(
        `/defects/${encodeURIComponent(selectedId)}`,
        "PATCH",
        {
          descriptionEl: values.descriptionEl,
          estimatedCost: Number.isNaN(values.estimatedCost) ? null : values.estimatedCost,
          riskBand: values.riskBand,
          funded: values.funded,
          targetProjectId: values.funded && values.targetProjectId.trim() !== "" ? values.targetProjectId : null,
          status: values.status,
        },
        DefectSchema,
      );
      setSelectedId(null);
      await refetchAll();
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSheetSaving(false);
    }
  }

  return (
    <Defects
      contract={contractQuery.data}
      defects={defectsQuery.data}
      areaNameById={areaNameById}
      areaOptions={areaOptions}
      projectById={projectById}
      projectOptions={projectOptions}
      state={state}
      onRetry={() => void refetchAll()}
      noPermission={noPermission}
      roles={roles}
      selectedId={selectedId}
      onSelect={selectRow}
      sheetSaving={sheetSaving}
      sheetApiError={sheetApiError}
      onCreate={(values) => void handleCreate(values)}
      onUpdate={(values) => void handleUpdate(values)}
    />
  );
}
