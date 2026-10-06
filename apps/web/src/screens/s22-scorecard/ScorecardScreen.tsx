"use client";

// S22 «Αξιολόγηση αναδόχων» — R37
//
// ScorecardScreen — owns the agreement and period choice, `useScorecard`, and
// the xlsx download (the S09a real-navigation pattern: the API builds the
// workbook with live formulas, ADR-0031 §9; this screen only fetches it).
import { useState, type ReactNode } from "react";
import { ApiError } from "@/data/client";
import { scorecardQueryString, useMaintenanceContracts, useScorecard } from "@/data/queries";
import { useOnlineStatus } from "@/screens/s18-work-orders/useOnlineStatus";
import { nicosiaToday, quarter, type Period } from "./period";
import { Scorecard, type ScorecardState } from "./Scorecard";

export interface ScorecardScreenProps {
  noPermission: ReactNode;
  defaultOrgUnitId?: string;
}

/** The xlsx download, through the proxy (a file, not a page — the S09a pattern). */
export function scorecardExportHref(query: { maintenanceContractId: string; from: string; to: string }): string {
  return `/api/proxy/maintenance/scorecard.xlsx?${scorecardQueryString(query)}`;
}

export function ScorecardScreen({ noPermission, defaultOrgUnitId }: ScorecardScreenProps) {
  const online = useOnlineStatus();
  const [today] = useState(() => nicosiaToday());
  // RULE (ADR-0031 §9): the contract pays quarterly; the last full quarter is what gets withheld from.
  const [period, setPeriod] = useState<Period>(() => quarter(today, -1));
  const agreements = useMaintenanceContracts();
  const [picked, setPicked] = useState("");
  const list = agreements.data ?? [];
  // Preselect: the remembered unit's active agreement, else the only one.
  const fallback =
    list.find((a) => a.orgUnitId === defaultOrgUnitId && a.status === "ACTIVE")?.id ?? (list.length === 1 ? list[0].id : "");
  const agreementId = picked || fallback;

  const query = { maintenanceContractId: agreementId, from: period.from, to: period.to };
  const { data, error, isLoading, refetch } = useScorecard(query);

  let state: ScorecardState;
  if (agreements.error instanceof ApiError && agreements.error.status === 403) state = "noPermission";
  else if (!agreementId) state = "idle";
  else if (!online && data) state = "offline";
  else if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && (error.status === 403 || error.status === 404) ? "noPermission" : "error";
  else state = "default";

  return (
    <Scorecard
      agreements={list}
      agreementsLoading={agreements.isLoading}
      agreementId={agreementId}
      onAgreement={setPicked}
      period={period}
      onPeriod={setPeriod}
      today={today}
      scorecard={data}
      state={state}
      onRetry={() => void refetch()}
      onExport={() => {
        if (!agreementId) return;
        window.location.href = scorecardExportHref(query);
      }}
      noPermission={noPermission}
    />
  );
}
