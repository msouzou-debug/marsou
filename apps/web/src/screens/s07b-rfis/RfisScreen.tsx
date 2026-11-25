"use client";

// S07b — R09 (ADR-0017)
//
/**
 * RfisScreen — the network-aware wrapper around `Rfis` (same Screen/pure
 * split as S07's own pair). Reads the contract (`useContract`, for the
 * eyebrow, tab strip and its counts) and the contract's own RFI list
 * (`useRfis`) side by side, and owns every mutation: create, answer, edit
 * (UAT 25/11/2026), close, and the correspondence upload (owner decision
 * 25/11/2026; `useRfiDocuments` reads the open RFI's files).
 * Every one refetches what it changed — the contract (its tab counts) and the
 * RFI list — before it resolves. Create closes the sheet; answer and close
 * (owner UAT 25/11/2026) leave it on the RFI, which now reads ANSWERED or
 * CLOSED from the refetched list.
 *
 * | Prop         | Type       | Notes                                             |
 * |--------------|------------|----------------------------------------------------|
 * | contractId   | string     | The `[id]` route segment.                           |
 * | roles        | AppRole[]  | `me.roles` — the write gate.                        |
 * | noPermission | ReactNode  | The shell's `NoPermission`.                         |
 */
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole, Rfi } from "@ecapital/shared";
import { RfiDocument, Rfi as RfiSchema } from "@ecapital/shared";
import { ApiError, apiMutate, apiMutateMultipart } from "@/data/client";
import { useContract, useRfiDocuments, useRfis } from "@/data/queries";
import { Rfis, type RfisScreenState } from "./Rfis";
import type { RfiAnswerFormValues, RfiEditFormValues, RfiFormValues } from "./schema";

export interface RfisScreenProps {
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

export function RfisScreen({ contractId, roles, noPermission }: RfisScreenProps) {
  const contractQuery = useContract(contractId);
  const rfisQuery = useRfis(contractId);
  const online = useOnlineStatus();
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  const [sheetApiError, setSheetApiError] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const documentsQuery = useRfiDocuments(contractId, selectedId && selectedId !== "new" ? selectedId : null);

  let state: RfisScreenState;
  if (!online && (contractQuery.data || rfisQuery.data)) {
    state = "offline";
  } else if (contractQuery.isLoading || rfisQuery.isLoading) {
    state = "loading";
  } else if (contractQuery.error) {
    state = contractQuery.error instanceof ApiError && contractQuery.error.status === 404 ? "noPermission" : "error";
  } else if (rfisQuery.error) {
    state = "error";
  } else if ((rfisQuery.data?.length ?? 0) === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  function selectRow(id: string | "new" | null) {
    setSheetApiError(undefined);
    setUploadError(undefined);
    setSelectedId(id);
  }

  /** Blank optional fields: left out of a new RFI, cleared (null) on an edit. */
  function blankToNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  async function refetchAll(): Promise<void> {
    await Promise.all([contractQuery.refetch(), rfisQuery.refetch()]);
  }

  async function handleCreate(values: RfiFormValues): Promise<void> {
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      const body = {
        questionEl: values.questionEl,
        slaDays: values.slaDays,
        recipientName: values.recipientName.trim(),
        ...(blankToNull(values.recipientEmail) ? { recipientEmail: blankToNull(values.recipientEmail) } : {}),
        ...(blankToNull(values.sentOn) ? { sentOn: values.sentOn } : {}),
      };
      await apiMutate<Rfi>(`/contracts/${encodeURIComponent(contractId)}/rfis`, "POST", body, RfiSchema);
      setSelectedId(null);
      await refetchAll();
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSheetSaving(false);
    }
  }

  /** Owner UAT 25/11/2026: the answer and the day it arrived; true once saved. */
  async function handleAnswer(values: RfiAnswerFormValues): Promise<boolean> {
    if (!selectedId || selectedId === "new") return false;
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<Rfi>(
        `/contracts/${encodeURIComponent(contractId)}/rfis/${encodeURIComponent(selectedId)}/answer`,
        "POST",
        { answerEl: values.answerEl.trim(), answeredOn: values.answeredOn },
        RfiSchema,
      );
      // Stay on the row: it now shows the answer and «Κλείσιμο αιτήματος».
      await refetchAll();
      return true;
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
      return false;
    } finally {
      setSheetSaving(false);
    }
  }

  /** UAT 25/11/2026: the sheet goes back to its read view when this is true. */
  async function handleUpdate(values: RfiEditFormValues): Promise<boolean> {
    if (!selectedId || selectedId === "new") return false;
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<Rfi>(
        `/contracts/${encodeURIComponent(contractId)}/rfis/${encodeURIComponent(selectedId)}`,
        "PATCH",
        {
          questionEl: values.questionEl.trim(),
          dueDate: values.dueDate,
          // An RFI from before the recipient existed may stay without one.
          ...(values.recipientName.trim() ? { recipientName: values.recipientName.trim() } : {}),
          recipientEmail: blankToNull(values.recipientEmail),
          sentOn: blankToNull(values.sentOn),
        },
        RfiSchema,
      );
      await refetchAll();
      return true;
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
      return false;
    } finally {
      setSheetSaving(false);
    }
  }

  /**
   * Owner decision 25/11/2026: the sent e-mail or the reply, filed against
   * the RFI. Multipart, the browser's own content-type (`apiMutateMultipart`);
   * a .msg the browser calls octet-stream is filed as Outlook by the API.
   */
  async function handleUpload(file: File, titleEl: string): Promise<boolean> {
    if (!selectedId || selectedId === "new") return false;
    setUploading(true);
    setUploadError(undefined);
    try {
      const form = new FormData();
      form.append("file", file);
      if (titleEl) form.append("titleEl", titleEl);
      await apiMutateMultipart(
        `/contracts/${encodeURIComponent(contractId)}/rfis/${encodeURIComponent(selectedId)}/documents`,
        form,
        RfiDocument,
      );
      await documentsQuery.refetch();
      return true;
    } catch (submitError) {
      setUploadError(submitError instanceof ApiError ? submitError.message : String(submitError));
      return false;
    } finally {
      setUploading(false);
    }
  }

  /**
   * Owner UAT 25/11/2026: with or without an answer; the note is left out
   * when blank. The sheet stays on the RFI and shows it closed, who closed
   * it and when; true once closed.
   */
  async function handleClose(closingNote: string): Promise<boolean> {
    if (!selectedId || selectedId === "new") return false;
    setSheetSaving(true);
    setSheetApiError(undefined);
    try {
      await apiMutate<Rfi>(
        `/contracts/${encodeURIComponent(contractId)}/rfis/${encodeURIComponent(selectedId)}/close`,
        "POST",
        closingNote.trim() ? { closingNote: closingNote.trim() } : {},
        RfiSchema,
      );
      await refetchAll();
      return true;
    } catch (submitError) {
      setSheetApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
      return false;
    } finally {
      setSheetSaving(false);
    }
  }

  return (
    <Rfis
      contract={contractQuery.data}
      rfis={rfisQuery.data}
      state={state}
      onRetry={() => void refetchAll()}
      noPermission={noPermission}
      roles={roles}
      selectedId={selectedId}
      onSelect={selectRow}
      sheetSaving={sheetSaving}
      sheetApiError={sheetApiError}
      onCreate={(values) => void handleCreate(values)}
      onAnswer={handleAnswer}
      onCloseRfi={handleClose}
      onUpdate={handleUpdate}
      documents={documentsQuery.data}
      onUpload={handleUpload}
      uploading={uploading}
      uploadError={uploadError}
    />
  );
}
