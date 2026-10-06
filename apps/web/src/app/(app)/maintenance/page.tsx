// S18 «Εντολές εργασίας» — R33, R34 (ADR-0031)
//
// Replaces the M0–M4 placeholder: the nav item now lands on the work order
// list. The unit filter starts on the unit the switcher remembers (the
// `ecapital_unit` cookie), or on a `?unit=` link; «ΟΚΥπΥ — όλες οι
// μονάδες» is a view, not a unit, so it starts unfiltered.
import { cookies } from "next/headers";
import { UNIT_COOKIE } from "@/auth/cookies";
import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { WorkOrdersScreen } from "@/screens/s18-work-orders/WorkOrdersScreen";

export default async function MaintenancePage({ searchParams }: PageProps<"/maintenance">) {
  const [session, orgUnits, params, unitCookie] = await Promise.all([getSession(), getVisibleOrgUnits(), searchParams, cookies()]);
  const fromLink = typeof params.unit === "string" ? params.unit : undefined;
  const remembered = unitCookie.get(UNIT_COOKIE)?.value;
  const unit = [fromLink, remembered].find((id) => id && orgUnits.some((u) => u.id === id));
  return (
    <>
      <WorkOrdersScreen
        orgUnits={orgUnits}
        roles={session?.me.roles ?? []}
        noPermission={<NoPermission />}
        initialFilters={unit ? { unit } : undefined}
      />
      <HelpSection route="/maintenance" />
    </>
  );
}
