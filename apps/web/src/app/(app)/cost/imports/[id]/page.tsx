// S10 — R14

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { UnmatchedQueueScreen } from "@/screens/s10-sap-import/UnmatchedQueueScreen";

export default async function CostImportBatchPage({ params }: PageProps<"/cost/imports/[id]">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <UnmatchedQueueScreen batchId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/cost/imports/[id]" />
    </>
  );
}
