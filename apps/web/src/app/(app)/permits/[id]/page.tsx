// Permit detail — R19–R25

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { PermitDetailScreen } from "@/screens/s11-permits/PermitDetailScreen";

export default async function PermitDetailPage({ params }: PageProps<"/permits/[id]">) {
  const { id } = await params;
  const [session, orgUnits] = await Promise.all([getSession(), getVisibleOrgUnits()]);
  return (
    <>
      <PermitDetailScreen
        permitId={id}
        roles={session?.me.roles ?? []}
        me={session?.me}
        orgUnits={orgUnits}
        noPermission={<NoPermission />}
      />
      <HelpSection route="/permits/[id]" />
    </>
  );
}
