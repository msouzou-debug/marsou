// S07g — ADR-0029

import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { EFinanceRequisitionsScreen } from "@/screens/s07g-efinance-requisitions/EFinanceRequisitionsScreen";

export default async function ContractEFinanceRequisitionsPage({
  params,
}: PageProps<"/contracts/[id]/efinance/requisitions">) {
  const { id } = await params;
  return (
    <>
      <EFinanceRequisitionsScreen contractId={id} noPermission={<NoPermission />} />
      <HelpSection route="/contracts/[id]/efinance/requisitions" />
    </>
  );
}
