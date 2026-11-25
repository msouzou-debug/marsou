"use client";

// S18b «Προληπτική συντήρηση» — which of the two views the URL asks for.
//
// `/maintenance/plan` is the agreements dashboard (owner UAT: every
// agreement, filtered by hospital and equipment type). `?view=agreement`
// is the original per-unit view; `&unit=…&agreement=…` opens it on one
// agreement, which is what a dashboard row links to.
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { AppRole, OrgUnit } from "@ecapital/shared";
import { AgreementsDashboardScreen } from "./AgreementsDashboardScreen";
import { PlanTabs } from "./PlanTabs";
import { PmPlanScreen } from "./PmPlanScreen";

export interface PmPlanRootProps {
  orgUnits: OrgUnit[];
  roles: AppRole[];
  defaultOrgUnitId?: string;
  noPermission: ReactNode;
}

export function PmPlanRoot({ orgUnits, roles, defaultOrgUnitId, noPermission }: PmPlanRootProps) {
  const searchParams = useSearchParams();
  if (searchParams.get("view") !== "agreement") {
    return <AgreementsDashboardScreen orgUnits={orgUnits} noPermission={noPermission} tabs={<PlanTabs active="dashboard" />} />;
  }
  const unit = searchParams.get("unit") ?? undefined;
  const agreementId = searchParams.get("agreement") ?? undefined;
  return (
    <PmPlanScreen
      // A different agreement from the dashboard is a fresh view, not a stale unit pick.
      key={`${unit ?? ""}:${agreementId ?? ""}`}
      orgUnits={orgUnits}
      roles={roles}
      defaultOrgUnitId={unit ?? defaultOrgUnitId}
      agreementId={agreementId}
      noPermission={noPermission}
      tabs={<PlanTabs active="agreement" />}
    />
  );
}
