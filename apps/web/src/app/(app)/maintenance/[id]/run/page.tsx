// S19 «Εκτέλεση εντολής» — R33, R34 (UI instructions §5 S19; phone-first)

import { getTranslations } from "next-intl/server";
import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { WorkOrderRunScreen } from "@/screens/s19-work-order-run/WorkOrderRunScreen";

export default async function WorkOrderRunPage({ params }: PageProps<"/maintenance/[id]/run">) {
  const { id } = await params;
  const [session, orgUnits, t] = await Promise.all([getSession(), getVisibleOrgUnits(), getTranslations("screens.s18detail")]);
  return (
    <>
      <WorkOrderRunScreen
        workOrderId={id}
        roles={session?.me.roles ?? []}
        orgUnits={orgUnits}
        noPermission={<NoPermission askRole={t("askRole")} />}
      />
      <HelpSection route="/maintenance/[id]/run" />
    </>
  );
}
