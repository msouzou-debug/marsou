// S09 — R11

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { PaymentCertsScreen } from "@/screens/s09-payment-certs/PaymentCertsScreen";

export default async function ContractCertificatesPage({ params }: PageProps<"/contracts/[id]/certificates">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <PaymentCertsScreen contractId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/contracts/[id]/certificates" />
    </>
  );
}
