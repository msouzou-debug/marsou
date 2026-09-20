// S17c — R30

import { getVisibleOrgUnits } from "@/data/server";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { ForecastScreen } from "@/screens/s17c-forecast/ForecastScreen";

export default async function AssetsForecastPage() {
  const orgUnits = await getVisibleOrgUnits();
  return (
    <>
      <ForecastScreen orgUnits={orgUnits} noPermission={<NoPermission />} />
      <HelpSection route="/assets/forecast" />
    </>
  );
}
