// S04 — R13, R14, R16, R17, R31

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { CostScreen } from "@/screens/s04-cost/CostScreen";

// Server Component, same split as S05/S08's own `page.tsx`: resolves
// `NoPermission` and the caller's roles once and hands the `[id]` segment
// down to `CostScreen` (a Client Component).
export default async function ProjectCostPage({ params }: PageProps<"/projects/[id]/cost">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <CostScreen projectId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/projects/[id]/cost" />
    </>
  );
}
