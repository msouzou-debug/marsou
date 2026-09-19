// S09a — R18

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { AccrualsScreen } from "@/screens/s09a-accruals/AccrualsScreen";

export default async function CostAccrualsPage() {
  const session = await getSession();
  return (
    <>
      <AccrualsScreen roles={session?.me.roles ?? []} noPermission={<NoPermission />} />
      <HelpSection route="/cost/accruals" />
    </>
  );
}
