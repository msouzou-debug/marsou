// S03 — R03, R04, R05, R07

import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { ProjectOverviewScreen } from "@/screens/s03-project/ProjectOverviewScreen";

// Server Component: resolves `NoPermission` (an async Server Component) once
// and hands the `[id]` segment and the element down to `ProjectOverviewScreen`
// (a Client Component) — same split as S02's `page.tsx` and S01's `Home`.
export default async function ProjectOverviewPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  return (
    <>
      <ProjectOverviewScreen projectId={id} noPermission={<NoPermission />} />
      <HelpSection route="/projects/[id]" />
    </>
  );
}
