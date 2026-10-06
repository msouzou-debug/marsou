// S22 «Αξιολόγηση αναδόχων» — R37 (ADR-0031 §9)

import { cookies } from "next/headers";
import { UNIT_COOKIE } from "@/auth/cookies";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { ScorecardScreen } from "@/screens/s22-scorecard/ScorecardScreen";

export default async function ScorecardPage() {
  const remembered = (await cookies()).get(UNIT_COOKIE)?.value;
  return (
    <>
      <ScorecardScreen noPermission={<NoPermission />} defaultOrgUnitId={remembered === "all" ? undefined : remembered} />
      <HelpSection route="/maintenance/scorecard" />
    </>
  );
}
