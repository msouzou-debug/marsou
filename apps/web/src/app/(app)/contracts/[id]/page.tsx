// S07 — R08, R10, R31

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { ContractOverviewScreen } from "@/screens/s07-contract/ContractOverviewScreen";

// Server Component: same split as S03's own `page.tsx` — resolves the
// session once (cached; the `(app)` layout already called it for this
// request) and hands the `[id]` segment and the caller's roles down to the
// Client Component that owns the actual fetch.
export default async function ContractOverviewPage({ params }: PageProps<"/contracts/[id]">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <ContractOverviewScreen contractId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/contracts/[id]" />
    </>
  );
}
