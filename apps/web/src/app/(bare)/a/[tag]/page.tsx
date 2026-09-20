// Scan route — R29 (M4 build brief item 5)
//
// `/a/<tag>` is the QR label's own payload (contract `QrLabel.url`): any
// phone camera opens it directly. Signed out, it goes through the sign-in
// gate with `next=` so the technician lands back here — and straight on to
// the asset — once they sign in, the same `next` pattern `sign-in/page.tsx`
// already reads. An unknown tag is the §6 "what happened, what to do"
// message, not a bare 404, with a link back to the register.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { serverApi } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { resolveScanTag } from "@/screens/s17-asset/scan";

export default async function ScanAssetPage({ params }: PageProps<"/a/[tag]">) {
  const { tag } = await params;
  const result = await resolveScanTag(await serverApi(), tag);
  if (result.kind === "signIn") redirect(result.href);
  if (result.kind === "found") redirect(`/assets/${encodeURIComponent(result.assetId)}`);

  const t = await getTranslations("screens.scan");
  return (
    <>
      <div className="flex min-h-screen flex-col items-center justify-center gap-s-4 p-s-8 text-center">
        <p className="text-fs-20 text-k-ink">{t("notFoundTitle")}</p>
        <p className="max-w-[400px] text-fs-16 text-k-text">{t("notFoundBody", { tag })}</p>
        <Link href="/assets" className="text-fs-16 text-k-blue underline-offset-2 hover:underline">
          {t("backToRegister")}
        </Link>
      </div>
      <HelpSection route="/a/[tag]" />
    </>
  );
}
