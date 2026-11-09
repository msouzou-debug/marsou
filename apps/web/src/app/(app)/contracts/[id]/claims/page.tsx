// S07i — ADR-0035

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { ClaimsScreen } from "@/screens/s07i-claims/ClaimsScreen";

export default async function ContractClaimsPage({ params }: PageProps<"/contracts/[id]/claims">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <ClaimsScreen contractId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/contracts/[id]/claims" />
    </>
  );
}
