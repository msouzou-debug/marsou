"use client";

// S18b agreements dashboard (owner UAT)
//
// AgreementsDashboardScreen — reads the filters from the URL, asks
// `GET /maintenance/agreements` for them, and writes every filter change
// back to the URL, so a filtered dashboard survives a refresh and can be
// sent as a link. A row opens the agreement's per-unit view.
import { useCallback, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { MaintenanceAgreementQuery, MaintenanceAgreementRow, OrgUnit } from "@ecapital/shared";
import { ApiError } from "@/data/client";
import { useMaintenanceAgreements } from "@/data/queries";
import { useOnlineStatus } from "@/screens/s18-work-orders/useOnlineStatus";
import { agreementDetailHref, agreementsHref, parseAgreementsQuery } from "./agreements-query";
import { AgreementsDashboard, type AgreementsDashboardState } from "./AgreementsDashboard";

export interface AgreementsDashboardScreenProps {
  orgUnits: OrgUnit[];
  noPermission: ReactNode;
  tabs?: ReactNode;
}

export function AgreementsDashboardScreen({ orgUnits, noPermission, tabs }: AgreementsDashboardScreenProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = parseAgreementsQuery(new URLSearchParams(searchParams.toString()));
  const online = useOnlineStatus();
  const { data, error, isLoading, refetch } = useMaintenanceAgreements(query);

  let state: AgreementsDashboardState;
  if (!online && data) state = "offline";
  else if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && error.status === 403 ? "noPermission" : "error";
  else if (data && data.items.length === 0) state = "empty";
  else state = "default";

  const onQueryChange = useCallback((next: MaintenanceAgreementQuery) => router.replace(agreementsHref(pathname, next)), [router, pathname]);

  return (
    <AgreementsDashboard
      data={data}
      state={state}
      query={query}
      orgUnits={orgUnits}
      onQueryChange={onQueryChange}
      onOpen={(row: MaintenanceAgreementRow) => router.push(agreementDetailHref(row))}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      tabs={tabs}
    />
  );
}
