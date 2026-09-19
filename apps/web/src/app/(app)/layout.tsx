import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { UNIT_COOKIE } from "@/auth/cookies";
import { getSession } from "@/auth/session";
import { AppShell } from "@/components/app-shell";
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
  const session = await getSession();
  if (!session) {
    // The cookie was there but `/me` rejected it (or the API is down). The
    // `stale` flag tells the proxy to delete it, so this happens once and
    // the next request is an ordinary signed-out one — never a loop.
    redirect("/sign-in?stale=1");
  }

  const orgUnits = await getVisibleOrgUnits();

  // Default: the remembered unit if it is still visible, otherwise the first.
  const remembered = (await cookies()).get(UNIT_COOKIE)?.value;
  const selectedUnitId = orgUnits.some((u) => u.id === remembered) ? remembered : orgUnits[0]?.id;

  return (
    <HelpProvider userRole={session.me.roles[0]}>
      {/* S25: mounted above every page so it survives client-side navigation
          while each page.tsx registers its own section underneath it. */}
      <AppShell me={session.me} orgUnits={orgUnits} defaultOrgUnitId={selectedUnitId}>
        {children}
      </AppShell>
    </HelpProvider>
  );
}
