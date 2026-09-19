// S05 — R06

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { ScheduleScreen } from "@/screens/s05-schedule/ScheduleScreen";

// Server Component, same split as S03's own `page.tsx`: resolves
// `NoPermission` and the caller's roles once and hands the `[id]` segment
// down to `ScheduleScreen` (a Client Component).
export default async function SchedulePage({ params }: PageProps<"/projects/[id]/schedule">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <ScheduleScreen projectId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/projects/[id]/schedule" />
    </>
  );
}
