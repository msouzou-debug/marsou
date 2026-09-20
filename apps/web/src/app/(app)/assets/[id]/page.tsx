// S17 — R26–R30, R45

import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { HelpSection } from "@/help/HelpSection";
import { getTranslations } from "next-intl/server";
import { AssetDetailScreen } from "@/screens/s17-asset/AssetDetailScreen";

export default async function AssetDetailPage({ params }: PageProps<"/assets/[id]">) {
  const { id } = await params;
  const [session, t] = await Promise.all([getSession(), getTranslations("screens.s17")]);
  return (
    <>
      <AssetDetailScreen assetId={id} roles={session?.me.roles ?? []} noPermission={<NoPermission askRole={t("askRole")} />} />
      <HelpSection route="/assets/[id]" />
    </>
  );
}
