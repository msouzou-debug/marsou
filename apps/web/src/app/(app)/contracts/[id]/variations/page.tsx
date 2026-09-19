// S08 — R10 (ADR-0015)

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { VariationsScreen } from "@/screens/s08-variations/VariationsScreen";

// The raiser comparison uses `me.userId`, the app_user row id that the API
// also stores in `variation.raisedById`, so the sheet can disable the
// decision for the raiser up front. The API's own `errors.sameUserApproval`
// (R10, ADR-0015) is still what stops a self-approval.
export default async function ContractVariationsPage({ params }: PageProps<"/contracts/[id]/variations">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <VariationsScreen
        contractId={id}
        roles={session?.me.roles ?? []}
        meUserId={session?.me.userId ?? ""}
        noPermission={<NoPermission />}
      />
      <HelpSection route="/contracts/[id]/variations" />
    </>
  );
}
