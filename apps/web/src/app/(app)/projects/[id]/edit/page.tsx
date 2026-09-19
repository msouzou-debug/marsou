// S02a — R04, R05

import { ProjectDetail } from "@ecapital/shared";
import { NoPermission } from "@/components/app-shell";
import { serverApi } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { ProjectFormScreen } from "@/screens/s02a-project-form/ProjectFormScreen";
import type { ProjectFormValues } from "@/screens/s02a-project-form/schema";

function toFormValues(project: ProjectDetail): ProjectFormValues {
  return {
    titleEl: project.titleEl,
    titleEn: project.titleEn,
    category: project.category,
    fundingSource: project.fundingSource,
    approvedBudget: project.approvedBudget,
    plannedStart: project.plannedStart,
    plannedFinish: project.plannedFinish,
    budgetYearFrom: project.budgetYearFrom,
    budgetYearTo: project.budgetYearTo,
    sapWbs: project.sapWbs,
    tenderReference: project.tenderReference,
  };
}

// Server Component: fetches the project server-side (`serverApi()`, the
// same fetcher S01/S02's server-rendered pieces use — ADR-0013's bearer
// never needs to cross into the browser just to prefill a form) so the form
// opens already filled in, rather than the client re-fetching what S03 just
// showed. RULE (ADR-0010): the API's 404 covers "no such project" and "not
// yours" alike, and this route does not try to tell them apart either —
// same `NoPermission` either way, same as S03.
export default async function EditProjectPage({ params }: PageProps<"/projects/[id]/edit">) {
  const { id } = await params;
  const api = await serverApi();
  const project = api ? await api.get(`/projects/${encodeURIComponent(id)}`, ProjectDetail).catch(() => null) : null;

  if (!project) return <NoPermission />;

  return (
    <>
      <ProjectFormScreen mode="edit" orgUnits={[]} projectId={project.id} initialValues={toFormValues(project)} />
      <HelpSection route="/projects/[id]/edit" />
    </>
  );
}
