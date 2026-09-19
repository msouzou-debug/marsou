// S15 — R25

import { NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { CalendarScreen } from "@/screens/s15-calendar/CalendarScreen";

export default async function CalendarPage() {
  const orgUnits = await getVisibleOrgUnits();
  return (
    <>
      <CalendarScreen orgUnits={orgUnits} noPermission={<NoPermission />} />
      <HelpSection route="/calendar" />
    </>
  );
}
