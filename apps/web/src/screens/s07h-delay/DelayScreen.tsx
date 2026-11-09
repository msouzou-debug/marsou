"use client";

// S07h — ADR-0035
//
/**
 * DelayScreen — the network-aware wrapper around `Delay`. Reads
 * `useContract(contractId)` (the detail carries sections, extensions and the
 * computed delay) and owns every write. Each one returns the whole
 * `ContractDetail`, so on success the screen simply refetches the one query
 * and the clocks, the totals and the warnings all move together.
 *
 * Routes (ADR-0035): `POST/PATCH/DELETE /contracts/:id/sections[/:sid]`,
 * `POST /contracts/:id/extensions`, `DELETE .../extensions/:eid` and
 * `POST /contracts/:id/delay/activate`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ContractDetail as ContractDetailSchema, type AppRole, type ContractExtensionWrite, type ContractSectionWrite, type DelayActivation } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useContract } from "@/data/queries";
import { Delay, type DelayScreenState } from "./Delay";
import type { ActivationFormValues, ExtensionFormValues, SectionFormValues } from "./schema";

export interface DelayScreenProps {
  contractId: string;
  roles: AppRole[];
  noPermission: ReactNode;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function DelayScreen({ contractId, roles, noPermission }: DelayScreenProps) {
  const { data, error, isLoading, refetch } = useContract(contractId);
  const online = useOnlineStatus();
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  let state: DelayScreenState;
  if (!online && data) state = "offline";
  else if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  else state = "default";

  const base = `/contracts/${encodeURIComponent(contractId)}`;

  async function run(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<boolean> {
    setSaving(true);
    setApiError(undefined);
    try {
      await apiMutate(`${base}${path}`, method, body, ContractDetailSchema);
      await refetch();
      return true;
    } catch (submitError) {
      setApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function sectionBody(values: SectionFormValues, sortOrder: number): ContractSectionWrite {
    return {
      code: values.code.trim(),
      titleEl: values.titleEl.trim(),
      completionDate: values.completionDate,
      handoverDate: values.handoverDate === "" ? null : values.handoverDate,
      liquidatedDamagesPerDay: values.liquidatedDamagesPerDay,
      sortOrder,
    };
  }

  return (
    <Delay
      data={data}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      saving={saving}
      apiError={apiError}
      onClearError={() => setApiError(undefined)}
      onSaveSection={(sectionId, values) => {
        if (sectionId) {
          const current = data?.sections?.find((s) => s.id === sectionId);
          return run(`/sections/${encodeURIComponent(sectionId)}`, "PATCH", sectionBody(values, current?.sortOrder ?? 0));
        }
        const next = Math.max(0, ...(data?.sections ?? []).map((s) => s.sortOrder)) + 1;
        return run("/sections", "POST", sectionBody(values, next));
      }}
      onDeleteSection={(sectionId) => run(`/sections/${encodeURIComponent(sectionId)}`, "DELETE")}
      onSaveExtension={(values: ExtensionFormValues) => {
        const body: ContractExtensionWrite = {
          sectionId: values.sectionId === "" ? null : values.sectionId,
          days: values.days,
          approvedAt: values.approvedAt,
          approver: values.approver === "" ? "OTHER" : values.approver,
          approverNameEl: values.approverNameEl.trim(),
          reasonEl: values.reasonEl.trim(),
          contractorCulpable: values.contractorCulpable === "yes",
        };
        return run("/extensions", "POST", body);
      }}
      onDeleteExtension={(extensionId) => run(`/extensions/${encodeURIComponent(extensionId)}`, "DELETE")}
      onActivate={(sectionId, values: ActivationFormValues) => {
        const body: DelayActivation = { sectionId, activatedAt: values.activatedAt, noteEl: values.noteEl.trim() };
        return run("/delay/activate", "POST", body);
      }}
    />
  );
}
