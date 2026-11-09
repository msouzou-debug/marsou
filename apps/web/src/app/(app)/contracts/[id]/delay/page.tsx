// S07h — ADR-0035

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { DelayScreen } from "@/screens/s07h-delay/DelayScreen";

export default async function ContractDelayPage({ params }: PageProps<"/contracts/[id]/delay">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <DelayScreen contractId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/contracts/[id]/delay" />
    </>
  );
}
