// S20 «Καταγραφή κλήσης» — R33 (phone-first)

import { cookies } from "next/headers";
import { UNIT_COOKIE } from "@/auth/cookies";
import { getSession } from "@/auth/session";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { CallFormScreen } from "@/screens/s20-call/CallFormScreen";

// Same posture as `assets/new/page.tsx`: a role that cannot raise a call
// never sees «Νέα κλήση», but opening the URL still renders the form,
// read-only, rather than a submit that would only come back 403.
export default async function NewCallPage() {
  const [session, orgUnits, unitCookie] = await Promise.all([getSession(), getVisibleOrgUnits(), cookies()]);
  const rememberedUnit = unitCookie.get(UNIT_COOKIE)?.value;
  // «ΟΚΥπΥ — όλες οι μονάδες» is a view, not a unit: no unit preselected then.
  const defaultOrgUnitId = rememberedUnit === "all" ? undefined : rememberedUnit;
  return (
    <>
      <CallFormScreen orgUnits={orgUnits} roles={session?.me.roles ?? []} defaultOrgUnitId={defaultOrgUnitId} />
      <HelpSection route="/maintenance/new" />
    </>
  );
}
