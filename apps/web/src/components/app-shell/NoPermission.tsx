import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

export interface NoPermissionProps {
  /** Where "back" goes. Defaults to the portfolio (the one route every role can reach). */
  backHref?: string;
  /** Override the who-to-ask sentence for a specific screen; already translated.
   *  Defaults to states.noPermission.askRole (the system administrator). */
  askRole?: string;
}

// RULE: no permission is never a blank page or a redirect loop (UI
// instructions §6) — always the reason, who to ask (a role, not a person),
// and a link back that goes somewhere real.
export async function NoPermission({ backHref = "/", askRole }: NoPermissionProps) {
  const t = await getTranslations("states.noPermission");
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-s-4 p-s-8 text-center">
      <ShieldAlert size={32} strokeWidth={1.5} aria-hidden="true" className="text-k-text" />
      <h1 className="text-fs-20">{t("title")}</h1>
      <p className="max-w-[400px] text-fs-16 text-k-text">{askRole ?? t("askRole")}</p>
      <Link href={backHref} className="text-fs-16 text-k-blue underline-offset-2 hover:underline">
        {t("backLink")}
      </Link>
    </div>
  );
}
