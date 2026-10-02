// S07f — ADR-0029

import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { EFinanceInvoicesScreen } from "@/screens/s07f-efinance-invoices/EFinanceInvoicesScreen";

// Read only, open to everybody who can see the contract: the API's row
// policies decide, and answer the same 404 for "no such contract" and "not
// yours" (ADR-0010), which the screen shows as NoPermission.
export default async function ContractEFinanceInvoicesPage({ params }: PageProps<"/contracts/[id]/efinance/invoices">) {
  const { id } = await params;
  return (
    <>
      <EFinanceInvoicesScreen contractId={id} noPermission={<NoPermission />} />
      <HelpSection route="/contracts/[id]/efinance/invoices" />
    </>
  );
}
