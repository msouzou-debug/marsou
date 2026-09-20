// S16a — R26–R30, R45

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { AssetsScreen } from "@/screens/s16a-assets/AssetsScreen";

export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const [session, orgUnits, params] = await Promise.all([getSession(), getVisibleOrgUnits(), searchParams]);
  const unit = typeof params.unit === "string" ? params.unit : undefined;
  const areaId = typeof params.areaId === "string" ? params.areaId : undefined;
  return (
    <>
      <AssetsScreen
        orgUnits={orgUnits}
        roles={session?.me.roles ?? []}
        noPermission={<NoPermission />}
        // RULE (build brief item 7): S16's own area row links here with
        // `?unit=&areaId=`, preselecting both filters.
        initialFilters={unit || areaId ? { unit: unit ?? "", areaId: areaId ?? "" } : undefined}
      />
      <HelpSection route="/assets" />
    </>
  );
}
