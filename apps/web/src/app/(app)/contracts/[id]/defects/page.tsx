// S07d — R12, R35 (ADR-0017)

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { DefectsScreen } from "@/screens/s07d-defects/DefectsScreen";

export default async function ContractDefectsPage({ params }: PageProps<"/contracts/[id]/defects">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <DefectsScreen contractId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/contracts/[id]/defects" />
    </>
  );
}
