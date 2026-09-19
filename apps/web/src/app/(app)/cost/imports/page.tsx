// S10 — R14

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { ImportsScreen } from "@/screens/s10-sap-import/ImportsScreen";

export default async function CostImportsPage() {
  const session = await getSession();
  return (
    <>
      <ImportsScreen roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/cost/imports" />
    </>
  );
}
