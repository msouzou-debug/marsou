"use client";

// S07c — R09 (ADR-0017)
//
// InstructionsScreen — the network-aware wrapper around `Instructions`, the
// same Screen/pure split as S07b's own pair. Reads the contract (eyebrow,
// tabs, the `instructionsWithoutVariation` warning and the variations array
// used to resolve a linked instruction's variation number) and the
// contract's own instruction list side by side.
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole, SiteInstruction, Variation } from "@ecapital/shared";
import { SiteInstruction as SiteInstructionSchema, Variation as VariationSchema } from "@ecapital/shared";
import { useRouter } from "next/navigation";
import { ApiError, apiMutate } from "@/data/client";
import { useContract, useSiteInstructions } from "@/data/queries";
import { Instructions, type InstructionsScreenState } from "./Instructions";
import type { InstructionFormValues } from "./schema";

export interface InstructionsScreenProps {
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

export function InstructionsScreen({ contractId, roles, noPermission }: InstructionsScreenProps) {
  const contractQuery = useContract(contractId);
  const instructionsQuery = useSiteInstructions(contractId);
  const online = useOnlineStatus();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetApiError, setSheetApiError] = useState<string | undefined>(undefined);
  const [creatingVariationId, setCreatingVariationId] = useState<string | null>(null);

  let state: InstructionsScreenState;
  if (!online && (contractQuery.data || instructionsQuery.data)) {
    state = "offline";
  } else if (contractQuery.isLoading || instructionsQuery.isLoading) {
    state = "loading";
  } else if (contractQuery.error) {
    state = contractQuery.error instanceof ApiError && contractQuery.error.status === 404 ? "noPermission" : "error";
  } else if (instructionsQuery.error) {
    state = "error";
  } else if ((instructionsQuery.data?.length ?? 0) === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  function selectRow(id: string | "new" | null) {
    setSheetApiError(undefined);
    setSelectedId(id);
  }

  async function refetchAll(): Promise<void> {
    await Promise.all([contractQuery.refetch(), instructionsQuery.refetch()]);
  }

  async function handleCreate(values: InstructionFormValues): Promise<void> {
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<SiteInstruction>(`/contracts/${encodeURIComponent(contractId)}/site-instructions`, "POST", values, SiteInstructionSchema);
      setSelectedId(null);
      await refetchAll();
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSheetSaving(false);
    }
  }

  // RULE (ADR-0017): only with cost impact, and only once — the API refuses
  // errors.noCostImpact / errors.alreadyLinked and this renders that
  // sentence verbatim (`ApiError.message` is already in the caller's
  // language) rather than a client-side guess at the wording.
  async function handleCreateVariation(instruction: SiteInstruction): Promise<void> {
    setCreatingVariationId(instruction.id);
    setSheetApiError(undefined);
    try {
      await apiMutate<Variation>(
        `/contracts/${encodeURIComponent(contractId)}/site-instructions/${encodeURIComponent(instruction.id)}/variation`,
        "POST",
        undefined,
        VariationSchema,
      );
      setSelectedId(null);
      router.push(`/contracts/${encodeURIComponent(contractId)}/variations`);
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setCreatingVariationId(null);
    }
  }

  return (
    <Instructions
      contract={contractQuery.data}
      instructions={instructionsQuery.data}
      state={state}
      onRetry={() => void refetchAll()}
      noPermission={noPermission}
      roles={roles}
      selectedId={selectedId}
      onSelect={selectRow}
      sheetSaving={sheetSaving}
      sheetApiError={sheetApiError}
      creatingVariationId={creatingVariationId}
      onCreate={(values) => void handleCreate(values)}
      onCreateVariation={(instruction) => void handleCreateVariation(instruction)}
    />
  );
}
