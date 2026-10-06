// S18a «Εντολή εργασίας» — R33, R34, R35 (ADR-0031)

import { getTranslations } from "next-intl/server";
import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { WorkOrderDetailScreen } from "@/screens/s18a-work-order/WorkOrderDetailScreen";

export default async function WorkOrderPage({ params }: PageProps<"/maintenance/[id]">) {
  const { id } = await params;
  const [session, t] = await Promise.all([getSession(), getTranslations("screens.s18detail")]);
  return (
    <>
      <WorkOrderDetailScreen workOrderId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission askRole={t("askRole")} />} />
      <HelpSection route="/maintenance/[id]" />
    </>
  );
}
