// S09 — R11

import { CertificateFormScreen } from "@/screens/s09-payment-certs/CertificateFormScreen";
import { HelpSection } from "@/help/HelpSection";

export default async function NewCertificatePage({ params }: PageProps<"/contracts/[id]/certificates/new">) {
  const { id } = await params;
  return (
    <>
      <CertificateFormScreen contractId={id} />
      <HelpSection route="/contracts/[id]/certificates/new" />
    </>
  );
}
