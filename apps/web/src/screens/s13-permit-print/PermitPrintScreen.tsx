"use client";

// S13 — R23
//
// PermitPrintScreen — the network-aware wrapper around `PermitPrint`.
import type { ReactNode } from "react";
import { ApiError } from "@/data/client";
import { usePermit } from "@/data/queries";
import { PermitPrint, type PermitPrintState } from "./PermitPrint";

export interface PermitPrintScreenProps {
  permitId: string;
  noPermission: ReactNode;
}

export function PermitPrintScreen({ permitId, noPermission }: PermitPrintScreenProps) {
  const { data, error, isLoading, refetch } = usePermit(permitId);

  let state: PermitPrintState;
  if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  else state = "default";

  const recordUrl = typeof window !== "undefined" ? `${window.location.origin}/permits/${encodeURIComponent(permitId)}` : `/permits/${permitId}`;

  return (
    <PermitPrint permit={data} state={state} recordUrl={recordUrl} onRetry={() => void refetch()} noPermission={noPermission} />
  );
}
