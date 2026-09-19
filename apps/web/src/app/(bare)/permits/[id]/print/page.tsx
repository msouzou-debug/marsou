// S13 — R23
//
// Route group note (`(bare)/layout.tsx`'s own header comment): a route
// group changes nothing about the URL, only the chrome — this renders at
// `/permits/[id]/print` with no top bar or nav rail, the way a sheet meant
// for a corridor barrier should.

import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { HelpSection } from "@/help/HelpSection";
import { PermitPrintScreen } from "@/screens/s13-permit-print/PermitPrintScreen";

export default async function PermitPrintPage({ params }: PageProps<"/permits/[id]/print">) {
  const session = await getSession();
  if (!session) redirect("/sign-in?stale=1");
  const { id } = await params;
  const t = await getTranslations("states.noPermission");
  return (
    <>
      <PermitPrintScreen permitId={id} noPermission={<p className="p-s-8 text-fs-16 text-k-ink">{t("title")}</p>} />
      <HelpSection route="/permits/[id]/print" />
    </>
  );
}
