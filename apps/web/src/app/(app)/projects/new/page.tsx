// S02a — R04, R05

import { cookies } from "next/headers";
import { UNIT_COOKIE } from "@/auth/cookies";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { ProjectFormScreen } from "@/screens/s02a-project-form/ProjectFormScreen";

// Server Component: resolves the caller's own visible units (R01) and the
// shell's remembered unit cookie once, same split as S02's own `page.tsx`.
// A role that may not create a project (`auditor_readonly`,
// `executive_readonly` — see `@/auth/roles`) never sees a live link to this
// route from S02 (its «Προσθήκη» stays a disabled button), but nothing here
// re-checks that: opening the URL directly still renders the form, and a
// submit from it gets the same 403 the API gives any other write it
// refuses — `ProjectFormScreen` shows it in the strip like any other
// failure (see that component's own header comment).
export default async function NewProjectPage() {
  const [orgUnits, unitCookie] = await Promise.all([getVisibleOrgUnits(), cookies()]);
  const defaultOrgUnitId = unitCookie.get(UNIT_COOKIE)?.value;
  return (
    <>
      <ProjectFormScreen mode="create" orgUnits={orgUnits} defaultOrgUnitId={defaultOrgUnitId} />
      <HelpSection route="/projects/new" />
    </>
  );
}
