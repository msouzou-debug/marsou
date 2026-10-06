// S23a «Αναφορά» — R39 (CAPEX-01 §11, ADR-0032)
//
// One page for the seven reports, `/reports/<slug>` with the slugs of
// REPORT_SLUG. An unknown slug is a 404, not an empty report.
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { UNIT_COOKIE } from "@/auth/cookies";
import { canViewReports } from "@/auth/roles";
import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { keyFromSlug } from "@/screens/s23-reports/catalogue";
import { ReportPageScreen } from "@/screens/s23-reports/ReportPageScreen";

export default async function ReportPage({ params }: PageProps<"/reports/[slug]">) {
  const { slug } = await params;
  const key = keyFromSlug(slug);
  if (!key) notFound();
  const [session, orgUnits, unitCookie] = await Promise.all([getSession(), getVisibleOrgUnits(), cookies()]);
  const remembered = unitCookie.get(UNIT_COOKIE)?.value;
  const unit = remembered && orgUnits.some((u) => u.id === remembered) ? remembered : undefined;
  const allowed = canViewReports(session?.me.roles ?? []);
  return (
    <>
      {allowed ? (
        <ReportPageScreen
          key={key}
          reportKey={key}
          orgUnits={orgUnits}
          defaultOrgUnitId={unit}
          noPermission={<NoPermission backHref="/reports" />}
        />
      ) : (
        <NoPermission />
      )}
      <HelpSection route="/reports/[slug]" />
    </>
  );
}
