import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PATH_HEADER, UNIT_COOKIE } from "@/auth/cookies";
import { RoleMatrixSync } from "@/auth/RoleMatrixSync";
import { getSessionState } from "@/auth/session";
import { AppShell } from "@/components/app-shell";
import { ALL_UNITS } from "@/components/app-shell/UnitSwitcher";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpProvider } from "@/help/HelpProvider";

// Everything behind the gate renders inside this layout: it resolves the
// session once, fetches the caller's own org units from the API with their
// bearer, and hands both to the shell.
//
// RULE (R01, ADR-0010): the switcher lists what `GET /org-units` returned and
// nothing else. There is no client-side filter and no fallback list — a unit
// the caller may not see never reaches the browser at all.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const state = await getSessionState();
  if (state.status === "unreachable") {
    // OWNER UAT 25/11/2026: the API is restarting for a release, or down. The
    // cookie may be perfectly good, so it is kept and the user is told to
    // try again, instead of being signed out by a restart.
    const t = await getTranslations();
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-s-4 p-s-8 text-center">
        <p role="alert" className="text-fs-16 text-k-ink">{t("states.error.unreachable")}</p>
        <a href={(await headers()).get(PATH_HEADER) ?? "/"} className="rounded-k border border-k-grey px-s-4 py-s-2 text-fs-14 text-k-blue-deep">
          {t("common.retry")}
        </a>
      </main>
    );
  }
  if (state.status !== "ok") {
    // The cookie was there but `/me` rejected it. The `stale` flag tells the
    // proxy to delete it, so this happens once and the next request is an
    // ordinary signed-out one — never a loop. `expired` makes the sign-in
    // page say why; `next` brings the user back to this page afterwards.
    const params = new URLSearchParams({ stale: "1", expired: "1" });
    const here = (await headers()).get(PATH_HEADER);
    if (here && here.startsWith("/") && !here.startsWith("//")) params.set("next", here);
    redirect(`/sign-in?${params.toString()}`);
  }
  const session = state.session;

  const orgUnits = await getVisibleOrgUnits();

  // Default: the remembered unit if it is still visible; «all units» for a
  // caller who sees more than one; otherwise their one unit.
  const remembered = (await cookies()).get(UNIT_COOKIE)?.value;
  const selectedUnitId = orgUnits.some((u) => u.id === remembered)
    ? remembered
    : orgUnits.length > 1
      ? ALL_UNITS
      : orgUnits[0]?.id;

  return (
    <HelpProvider userRole={session.me.roles[0]}>
      {/* ADR-0033: the role matrix the helpers read, in the browser too. */}
      <RoleMatrixSync matrix={session.matrix}>
        {/* S25: mounted above every page so it survives client-side navigation
            while each page.tsx registers its own section underneath it. */}
        <AppShell me={session.me} orgUnits={orgUnits} defaultOrgUnitId={selectedUnitId}>
          {children}
        </AppShell>
      </RoleMatrixSync>
    </HelpProvider>
  );
}
