// S11a — R19

import { cookies } from "next/headers";
import { UNIT_COOKIE } from "@/auth/cookies";
import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { PermitWizardScreen } from "@/screens/s11a-permit-request/PermitWizardScreen";

export default async function NewPermitPage() {
  const [session, orgUnits, unitCookie] = await Promise.all([getSession(), getVisibleOrgUnits(), cookies()]);
  const defaultOrgUnitId = unitCookie.get(UNIT_COOKIE)?.value;
  return (
    <>
      <PermitWizardScreen
        mode="create"
        roles={session?.me.roles ?? []}
        orgUnits={orgUnits}
        defaultOrgUnitId={defaultOrgUnitId}
        noPermission={<NoPermission />}
      />
      <HelpSection route="/permits/new" />
    </>
  );
}
