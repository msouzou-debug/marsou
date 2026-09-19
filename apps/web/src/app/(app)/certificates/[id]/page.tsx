// S09 — R11

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { CertificateDetailScreen } from "@/screens/s09-payment-certs/CertificateDetailScreen";

export default async function CertificateDetailPage({ params }: PageProps<"/certificates/[id]">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <CertificateDetailScreen certId={id} roles={session?.me.roles ?? []} meUserId={session?.me.userId ?? ""} noPermission={<NoPermission />} />
      <HelpSection route="/certificates/[id]" />
    </>
  );
}
