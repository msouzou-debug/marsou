"use client";

// S10 — R14
//
/**
 * ImportsScreen — the network-aware wrapper around `Imports`. Owns
 * `useImportBatches()` and the one multipart write this build has,
 * `POST /cost/imports` (`apiMutateMultipart`, `src/data/client.ts`). A dry
 * run's `ImportBatch.exceptions` (the API's own preview rows, when it sends
 * them) surface as `UploadCard`'s result panel; a real import (dryRun=false)
 * clears that panel, refetches the list and opens the new batch's own
 * unmatched-queue page — there is nothing left to preview once it exists.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AppRole, ImportBatch, SapReport } from "@ecapital/shared";
import { ImportBatch as ImportBatchSchema } from "@ecapital/shared";
import { z } from "zod";
import { ApiError, apiMutateMultipart } from "@/data/client";
import { useImportBatches } from "@/data/queries";
import type { DryRunResult } from "./UploadCard";
import { Imports, type ImportsScreenState } from "./Imports";

export interface ImportsScreenProps {
  roles: AppRole[];
  noPermission: ReactNode;
}

// The API may answer a dry run with the batch plus a preview of the rows it
// could not match, under a key the shared `ImportBatch` schema does not
// carry (a dry run is the one response shape richer than the stored batch).
// Read loosely rather than widening the shared contract for a preview-only
// field, per §7's "pick the reading closest to the brief" guidance.
const DryRunResponse = ImportBatchSchema.and(
  z.object({ exceptions: z.array(z.string()).optional() }).partial(),
);

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

export function ImportsScreen({ roles, noPermission }: ImportsScreenProps) {
  const router = useRouter();
  const { data, error, isLoading, refetch } = useImportBatches();
  const online = useOnlineStatus();

  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);

  let state: ImportsScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 403 ? "noPermission" : "error";
  } else if ((data ?? []).length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  async function upload(file: File, report: SapReport, period: string, dryRun: boolean): Promise<void> {
    setSubmitting(true);
    setApiError(undefined);
    if (dryRun) setDryRunResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("report", report);
      form.set("period", period);
      form.set("dryRun", dryRun ? "true" : "false");
      const batch = await apiMutateMultipart("/cost/imports", form, DryRunResponse);
      if (dryRun) {
        setDryRunResult({ matched: batch.rowsMatched, total: batch.rowsIn, exceptions: batch.exceptions ?? [] });
      } else {
        setDryRunResult(null);
        await refetch();
        router.push(`/cost/imports/${encodeURIComponent(batch.id)}`);
      }
    } catch (submitError) {
      setApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Imports
      data={data}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      onRowOpen={(batch: ImportBatch) => router.push(`/cost/imports/${encodeURIComponent(batch.id)}`)}
      uploadSubmitting={submitting}
      uploadApiError={apiError}
      dryRunResult={dryRunResult}
      onUpload={(file, report, period, dryRun) => void upload(file, report, period, dryRun)}
    />
  );
}
