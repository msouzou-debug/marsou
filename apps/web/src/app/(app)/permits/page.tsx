// S11 (list) — R19–R25

import { NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { PermitsScreen } from "@/screens/s11-permits/PermitsScreen";

export default async function PermitsPage() {
  const orgUnits = await getVisibleOrgUnits();
  return (
    <>
      <PermitsScreen orgUnits={orgUnits} noPermission={<NoPermission />} />
      <HelpSection route="/permits" />
    </>
  );
}
