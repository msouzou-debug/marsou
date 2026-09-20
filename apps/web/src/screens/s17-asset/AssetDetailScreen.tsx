"use client";

// S17 — R26–R30, R45
//
// AssetDetailScreen — the network-aware wrapper around `AssetDetail`. Owns
// `useAsset` and the three writes this record page makes: `POST
// /assets/:id/condition`, `POST /assets/:id/readings` and `POST
// /assets/:id/documents` (multipart).
import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import type { AppRole, AssetDocumentKind } from "@ecapital/shared";
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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_CONDITION: ConditionFormValue = { condition: "A", assessedAt: today(), noteEl: "" };
const EMPTY_READING: ReadingFormValue = { takenAt: today(), readingType: "", value: "", unit: "" };
const EMPTY_DOCUMENT: DocumentFormValue = { kind: "OM_MANUAL", titleEl: "", file: null };

export function AssetDetailScreen({ assetId, roles, noPermission }: AssetDetailScreenProps) {
  const { data, error, isLoading, refetch } = useAsset(assetId);
  const online = useOnlineStatus();

  const [conditionForm, setConditionForm] = useState<ConditionFormValue>(EMPTY_CONDITION);
  const [conditionSaving, setConditionSaving] = useState(false);
  const [conditionError, setConditionError] = useState<string | undefined>(undefined);

  const [readingForm, setReadingForm] = useState<ReadingFormValue>(EMPTY_READING);
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

  async function submitCondition(): Promise<void> {
    setConditionSaving(true);
    setConditionError(undefined);
    try {
      // The route's own response shape is not part of the M4 endpoint list
      // this build was given — `refetch()` below reads the asset back
      // through `useAsset`'s own schema regardless, so the write itself
      // only needs the status code, not a second parse of the body.
      await apiMutate(
        `/assets/${encodeURIComponent(assetId)}/condition`,
        "POST",
        { condition: conditionForm.condition, assessedAt: conditionForm.assessedAt || undefined, noteEl: conditionForm.noteEl || undefined },
        z.unknown(),
      );
      setConditionForm(EMPTY_CONDITION);
      await refetch();
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
      setReadingForm(EMPTY_READING);
      await refetch();
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
      onConditionFormChange={setConditionForm}
      conditionSaving={conditionSaving}
      conditionError={conditionError}
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
