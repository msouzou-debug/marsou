"use client";

// S07i — ADR-0035
//
/**
 * ClaimsScreen — the network-aware wrapper around `Claims`. Reads
 * `useContract` (the detail carries `claims`) and owns `POST
 * /contracts/:id/claims` and `PATCH /contracts/:id/claims/:cid`, both of
 * which answer with the whole `ContractDetail`, and the paper picked on the
 * sheet: `POST /contracts/:id/claims/:cid/documents` (multipart, 0029), sent
 * once the claim is saved. A new claim's id is the one the answer carries
 * that the contract did not have before.
 *
 * If the claim saves and the paper does not, the panel stays open with the
 * API's sentence: the claim is on record, and saving again files the paper.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ContractDetail as ContractDetailSchema, type AppRole, type ContractClaimWrite } from "@ecapital/shared";
import { z } from "zod";
import { ApiError, apiMutate, apiMutateMultipart } from "@/data/client";
import { useContract } from "@/data/queries";
import { Claims, type ClaimsScreenState } from "./Claims";
import type { ClaimAttachment, ClaimFormValues } from "./schema";

/**
 * A browser often reports an e-mail saved to disk as no type at all, or as
 * `application/octet-stream`, neither of which is on eArchive's whitelist;
 * the extension says what it is.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  pdf: "application/pdf",
};

export function attachmentMime(file: File): string | null {
  if (file.type && file.type !== "application/octet-stream") return null;
  const extension = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? null;
}

export interface ClaimsScreenProps {
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

export function ClaimsScreen({ contractId, roles, noPermission }: ClaimsScreenProps) {
  const { data, error, isLoading, refetch } = useContract(contractId);
  const online = useOnlineStatus();
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  let state: ClaimsScreenState;
  if (!online && data) state = "offline";
  else if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  else state = "default";

  async function save(claimId: string | null, values: ClaimFormValues, attachment?: ClaimAttachment): Promise<boolean> {
    const body: ContractClaimWrite = {
      direction: values.direction,
      titleEl: values.titleEl.trim(),
      amount: values.amount,
      stage: values.stage,
      notifiedAt: values.notifiedAt === "" ? null : values.notifiedAt,
      legalAdvisorEl: values.legalAdvisorEl.trim() === "" ? null : values.legalAdvisorEl.trim(),
      contingentLiability: values.contingentLiability,
      notesEl: values.notesEl,
    };
    const base = `/contracts/${encodeURIComponent(contractId)}/claims`;
    setSaving(true);
    setApiError(undefined);
    let savedId = claimId;
    try {
      if (claimId) {
        await apiMutate(`${base}/${encodeURIComponent(claimId)}`, "PATCH", body, ContractDetailSchema);
      } else {
        const before = new Set((data?.claims ?? []).map((c) => c.id));
        const after = await apiMutate(base, "POST", body, ContractDetailSchema);
        savedId = after.claims?.find((c) => !before.has(c.id))?.id ?? null;
      }
      if (attachment && savedId) {
        const form = new FormData();
        form.set("file", attachment.file);
        form.set("kind", attachment.kind);
        if (attachment.titleEl) form.set("titleEl", attachment.titleEl);
        const mime = attachmentMime(attachment.file);
        if (mime) form.set("mime", mime);
        await apiMutateMultipart(`${base}/${encodeURIComponent(savedId)}/documents`, form, z.unknown());
      }
      await refetch();
      return true;
    } catch (submitError) {
      setApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
      // The claim may be on record already; show it.
      if (savedId) await refetch();
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <Claims
      data={data}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      saving={saving}
      apiError={apiError}
      onClearError={() => setApiError(undefined)}
      onSave={save}
    />
  );
}
