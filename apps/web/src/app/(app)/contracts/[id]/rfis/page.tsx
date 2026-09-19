// S07b — R09 (ADR-0017)

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { RfisScreen } from "@/screens/s07b-rfis/RfisScreen";

export default async function ContractRfisPage({ params }: PageProps<"/contracts/[id]/rfis">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <RfisScreen contractId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/contracts/[id]/rfis" />
    </>
  );
}
