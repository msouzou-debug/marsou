// S06 — R07

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { RisksIssuesScreen } from "@/screens/s06-risks-issues/RisksIssuesScreen";

// Server Component, same split as S03's and S05's own `page.tsx`.
export default async function RisksIssuesPage({ params }: PageProps<"/projects/[id]/risks">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <RisksIssuesScreen projectId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/projects/[id]/risks" />
    </>
  );
}
