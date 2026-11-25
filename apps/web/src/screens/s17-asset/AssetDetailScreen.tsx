"use client";

// S17 — R26–R30, R45
//
// AssetDetailScreen — the network-aware wrapper around `AssetDetail`. Owns
// `useAsset` and the three writes this record page makes: `POST
// /assets/:id/condition`, `POST /assets/:id/readings` and `POST
// /assets/:id/documents` (multipart).
//
// Owner UAT 25/11/2026, «asset condition: a change does not take effect».
// The condition was saved, but the form went back to «A» afterwards, which
// read as the change being lost. Now the condition dropdown starts on the
// asset's own condition and stays on the value saved, the date starts on
// today (Nicosia, worked out when the form is shown, not when the module
// loaded), a confirmation says it was recorded, and the asset and every
// asset list are invalidated so no screen shows the old band from cache.
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { nicosiaToday, type AppRole, type AssetDocumentKind, type Condition } from "@ecapital/shared";
import { canRecordAssetCondition, canUploadAssetDocuments, canWriteAssets } from "@/auth/roles";
import { ApiError, apiMutateMultipart, apiMutate } from "@/data/client";
import { useAsset } from "@/data/queries";
import {
  AssetDetail,
  type AssetDetailState,
  type ConditionFormValue,
  type DocumentFormValue,
  type ReadingFormValue,
} from "./AssetDetail";

export interface AssetDetailScreenProps {
  assetId: string;
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

/** Today in Nicosia, asked when it is needed rather than once at module load. */
function today(): string {
  return nicosiaToday();
}

/** The condition form for an asset: its own band (A when it has none), dated today. */
function conditionFormFor(condition: Condition | null | undefined): ConditionFormValue {
  return { condition: condition ?? "A", assessedAt: today(), noteEl: "" };
}

const emptyReading = (): ReadingFormValue => ({ takenAt: today(), readingType: "", value: "", unit: "" });
const EMPTY_DOCUMENT: DocumentFormValue = { kind: "OM_MANUAL", titleEl: "", file: null };

export function AssetDetailScreen({ assetId, roles, noPermission }: AssetDetailScreenProps) {
  const { data, error, isLoading, refetch } = useAsset(assetId);
  const queryClient = useQueryClient();
  const online = useOnlineStatus();

  // Null until somebody touches the form: until then it shows the asset's
  // own condition, whatever the latest read of the asset says.
  const [conditionDraft, setConditionDraft] = useState<ConditionFormValue | null>(null);
  const conditionForm = conditionDraft ?? conditionFormFor(data?.condition);
  const [conditionSaving, setConditionSaving] = useState(false);
  const [conditionError, setConditionError] = useState<string | undefined>(undefined);
  const [conditionSaved, setConditionSaved] = useState(false);

  const [readingForm, setReadingForm] = useState<ReadingFormValue>(emptyReading);
  const [readingSaving, setReadingSaving] = useState(false);
  const [readingError, setReadingError] = useState<string | undefined>(undefined);

  const [documentSheetOpen, setDocumentSheetOpen] = useState(false);
  const [documentForm, setDocumentForm] = useState<DocumentFormValue>(EMPTY_DOCUMENT);
  const [documentUploading, setDocumentUploading] = useState(false);
  const [documentError, setDocumentError] = useState<string | undefined>(undefined);

  let state: AssetDetailState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  } else {
    state = "default";
  }

  const assetUrl = typeof window !== "undefined" ? `${window.location.origin}/a/${encodeURIComponent(data?.tag ?? "")}` : `/a/${assetId}`;

  /** The asset itself and every list it appears in: none may show the old band. */
  async function refreshAsset(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["asset", assetId] }),
      queryClient.invalidateQueries({ queryKey: ["assets"] }),
      queryClient.invalidateQueries({ queryKey: ["assets-for-unit"] }),
    ]);
    await refetch();
  }

  function changeCondition(next: ConditionFormValue): void {
    setConditionSaved(false);
    setConditionDraft(next);
  }

  async function submitCondition(): Promise<void> {
    const submitted = conditionForm;
    setConditionSaving(true);
    setConditionError(undefined);
    setConditionSaved(false);
    try {
      // The route's own response shape is not part of the M4 endpoint list
      // this build was given — `refetch()` below reads the asset back
      // through `useAsset`'s own schema regardless, so the write itself
      // only needs the status code, not a second parse of the body.
      await apiMutate(
        `/assets/${encodeURIComponent(assetId)}/condition`,
        "POST",
        { condition: submitted.condition, assessedAt: submitted.assessedAt || undefined, noteEl: submitted.noteEl || undefined },
        z.unknown(),
      );
      // The dropdown stays on what was saved; the note is spent; the date
      // goes back to today for the next one.
      setConditionDraft(conditionFormFor(submitted.condition));
      setConditionSaved(true);
      await refreshAsset();
    } catch (submitError) {
      setConditionError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setConditionSaving(false);
    }
  }

  async function submitReading(): Promise<void> {
    setReadingSaving(true);
    setReadingError(undefined);
    try {
      const value = Number(readingForm.value);
      if (Number.isNaN(value)) throw new Error("invalid");
      await apiMutate(
        `/assets/${encodeURIComponent(assetId)}/readings`,
        "POST",
        { takenAt: readingForm.takenAt, readingType: readingForm.readingType, value, unit: readingForm.unit || undefined },
        z.unknown(),
      );
      setReadingForm(emptyReading());
      await refreshAsset();
    } catch (submitError) {
      setReadingError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setReadingSaving(false);
    }
  }

  async function submitDocument(): Promise<void> {
    if (!documentForm.file) return;
    setDocumentUploading(true);
    setDocumentError(undefined);
    try {
      const form = new FormData();
      form.set("file", documentForm.file);
      form.set("kind", documentForm.kind satisfies AssetDocumentKind);
      form.set("titleEl", documentForm.titleEl);
      await apiMutateMultipart(`/assets/${encodeURIComponent(assetId)}/documents`, form, z.unknown());
      setDocumentForm(EMPTY_DOCUMENT);
      setDocumentSheetOpen(false);
      await refetch();
    } catch (submitError) {
      setDocumentError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setDocumentUploading(false);
    }
  }

  return (
    <AssetDetail
      asset={data}
      state={state}
      assetUrl={assetUrl}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      canWrite={canWriteAssets(roles)}
      canRecordCondition={canRecordAssetCondition(roles)}
      canUploadDocuments={canUploadAssetDocuments(roles)}
      conditionForm={conditionForm}
      onConditionFormChange={changeCondition}
      conditionSaving={conditionSaving}
      conditionError={conditionError}
      conditionSaved={conditionSaved}
      onSubmitCondition={() => void submitCondition()}
      readingForm={readingForm}
      onReadingFormChange={setReadingForm}
      readingSaving={readingSaving}
      readingError={readingError}
      onSubmitReading={() => void submitReading()}
      documentSheetOpen={documentSheetOpen}
      onOpenDocumentSheet={() => setDocumentSheetOpen(true)}
      onCloseDocumentSheet={() => setDocumentSheetOpen(false)}
      documentForm={documentForm}
      onDocumentFormChange={setDocumentForm}
      documentUploading={documentUploading}
      documentError={documentError}
      onSubmitDocument={() => void submitDocument()}
    />
  );
}
