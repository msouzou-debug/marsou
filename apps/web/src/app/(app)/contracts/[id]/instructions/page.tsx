// S07c — R09 (ADR-0017)

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { InstructionsScreen } from "@/screens/s07c-instructions/InstructionsScreen";

export default async function ContractInstructionsPage({ params }: PageProps<"/contracts/[id]/instructions">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <InstructionsScreen contractId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/contracts/[id]/instructions" />
    </>
  );
}
