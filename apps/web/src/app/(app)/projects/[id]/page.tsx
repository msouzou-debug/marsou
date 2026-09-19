// S03 — R03, R04, R05, R07

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { ProjectOverviewScreen } from "@/screens/s03-project/ProjectOverviewScreen";

// Server Component: resolves `NoPermission` (an async Server Component) once
// and hands the `[id]` segment, the caller's roles and the element down to
// `ProjectOverviewScreen` (a Client Component) — same split as S02's
// `page.tsx` and S01's `Home`. `getSession()` costs no extra request here:
// it is wrapped in React's `cache`, and the `(app)` layout already called it
// once to build the shell for this same request.
export default async function ProjectOverviewPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const session = await getSession();
  return (
    <>
      <ProjectOverviewScreen projectId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/projects/[id]" />
    </>
  );
}
