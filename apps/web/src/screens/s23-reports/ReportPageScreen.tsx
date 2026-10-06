"use client";

// S23a «Αναφορά» — R39 (ADR-0032)
//
// ReportPageScreen — owns the filter, `useReport` and the xlsx download.
// The download is a navigation through the same-origin proxy (the S09a /
// S22 pattern): the proxy adds the bearer on the server and forwards the
// API's Content-Disposition, so the token never reaches this code.
import { useState, type ReactNode } from "react";
import type { OrgUnit, ReportKey, ReportQuery } from "@ecapital/shared";
import { ApiError } from "@/data/client";
import { reportExportHref, useReport } from "@/data/queries";
import { useOnlineStatus } from "@/screens/s18-work-orders/useOnlineStatus";
import { nicosiaToday } from "@/screens/s22-scorecard/period";
import { catalogueEntry, defaultQuery } from "./catalogue";
import { ReportPage, type ReportPageState } from "./ReportPage";

export interface ReportPageScreenProps {
  reportKey: ReportKey;
  orgUnits: OrgUnit[];
  defaultOrgUnitId?: string;
  noPermission: ReactNode;
}

export function ReportPageScreen({ reportKey, orgUnits, defaultOrgUnitId, noPermission }: ReportPageScreenProps) {
  const online = useOnlineStatus();
  const [today] = useState(() => nicosiaToday());
  const [query, setQuery] = useState<ReportQuery>(() => defaultQuery(catalogueEntry(reportKey), today, defaultOrgUnitId));
  const [exporting, setExporting] = useState(false);
  const { data, error, isLoading, refetch } = useReport(reportKey, query);

  let state: ReportPageState;
  if (!online && data) state = "offline";
  else if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && (error.status === 403 || error.status === 404) ? "noPermission" : "error";
  else state = "default";

  return (
    <ReportPage
      reportKey={reportKey}
      orgUnits={orgUnits}
      query={query}
      onQuery={setQuery}
      today={today}
      report={data}
      state={state}
      onRetry={() => void refetch()}
      onExcel={() => {
        setExporting(true);
        window.location.href = reportExportHref(reportKey, query);
        window.setTimeout(() => setExporting(false), 1500);
      }}
      exporting={exporting}
      noPermission={noPermission}
    />
  );
}
