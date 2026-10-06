// S23 «Αναφορές» — R39 (CAPEX-01 §11, ADR-0032)
//
// The index of the seven reports. RULE (ADR-0032 §6): for the head of
// estates, finance, executive, auditor and admin; anyone else gets the
// no-permission page here rather than a list of links that all answer 403.
import { getSession } from "@/auth/session";
import { canViewReports } from "@/auth/roles";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { ReportIndexScreen } from "@/screens/s23-reports/ReportIndexScreen";

export default async function ReportsPage() {
  const session = await getSession();
  const allowed = canViewReports(session?.me.roles ?? []);
  return (
    <>
      {allowed ? <ReportIndexScreen noPermission={<NoPermission />} /> : <NoPermission />}
      <HelpSection route="/reports" />
    </>
  );
}
