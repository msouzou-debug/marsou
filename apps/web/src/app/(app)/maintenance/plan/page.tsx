// S18b «Προληπτική συντήρηση» — R32 (ADR-0031 §1, §2)

import { cookies } from "next/headers";
import { UNIT_COOKIE } from "@/auth/cookies";
import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { PmPlanScreen } from "@/screens/s18b-pm-plan/PmPlanScreen";

export default async function PmPlanPage() {
  const [session, orgUnits, unitCookie] = await Promise.all([getSession(), getVisibleOrgUnits(), cookies()]);
  const rememberedUnit = unitCookie.get(UNIT_COOKIE)?.value;
  const defaultOrgUnitId = rememberedUnit === "all" ? undefined : rememberedUnit;
  return (
    <>
      <PmPlanScreen orgUnits={orgUnits} roles={session?.me.roles ?? []} defaultOrgUnitId={defaultOrgUnitId} noPermission={<NoPermission />} />
      <HelpSection route="/maintenance/plan" />
    </>
  );
}
