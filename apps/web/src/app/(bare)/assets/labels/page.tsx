// S17b — R26–R30, R45

import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { HelpSection } from "@/help/HelpSection";
import { LabelsScreen } from "@/screens/s17b-labels/LabelsScreen";

export default async function AssetLabelsPage({ searchParams }: PageProps<"/assets/labels">) {
  const session = await getSession();
  if (!session) redirect("/sign-in?stale=1");
  const params = await searchParams;
  const raw = typeof params.ids === "string" ? params.ids : "";
  const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
  return (
    <>
      <LabelsScreen ids={ids} />
      <HelpSection route="/assets/labels" />
    </>
  );
}
