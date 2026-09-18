import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import type { OrgUnit } from "@ecapital/shared";
import { BottomTabBar } from "./BottomTabBar";
import { FALLBACK_ORG_UNITS } from "./fallback-org-units";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";

// Props:
// | Prop             | Type         | Notes                                                    |
// |-------------------|--------------|------------------------------------------------------------|
// | children          | ReactNode     | the page body                                              |
// | orgUnits          | OrgUnit[]?    | the org units; falls back to the seeded eleven (ADR-0005)    |
// | defaultOrgUnitId  | string?       | pre-selects a unit in the switcher                         |
// | approvalsCount    | number?       | badge on Εγκρίσεις, in the rail and the phone tab bar       |
// | userName          | string?       | falls back to common.user ("Χρήστης" / "User")             |
// | onHelp            | () => void?   | wired up once the help drawer (S25) exists                 |
// | offlineSlot       | ReactNode?    | where OfflineChip mounts later; nothing renders without it |
export interface AppShellProps {
  children: ReactNode;
  orgUnits?: OrgUnit[];
  defaultOrgUnitId?: string;
  approvalsCount?: number;
  userName?: string;
  onHelp?: () => void;
  offlineSlot?: ReactNode;
}

// Wired into every route through src/app/layout.tsx. Desktop (≥1440) and
// tablet (≥1024): 56px top bar + a nav rail (240px, or 56px icon-only at
// tablet width). Phone (<1024): no rail, a 56px bottom tab bar instead (UI
// instructions §2).
//
// Server component: the top bar and the rail render immediately, before any
// page data arrives — loading is a page-level concern, not the shell's (UI
// instructions §6). Interactive pieces (unit switcher, language toggle, the
// phone "more" sheet, the rail's tooltip/collapse behaviour) are the small
// client islands underneath.
export async function AppShell({
  children,
  orgUnits = FALLBACK_ORG_UNITS,
  defaultOrgUnitId,
  approvalsCount = 0,
  userName,
  onHelp,
  offlineSlot,
}: AppShellProps) {
  const t = await getTranslations("shell");
  return (
    <div className="flex min-h-screen flex-col bg-k-white">
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-s-4 focus-visible:top-s-2 focus-visible:z-40 focus-visible:rounded-k focus-visible:bg-k-white focus-visible:px-s-3 focus-visible:py-s-2 focus-visible:shadow-k"
      >
        {t("skipToContent")}
      </a>
      <TopBar
        orgUnits={orgUnits}
        defaultOrgUnitId={defaultOrgUnitId}
        userName={userName}
        onHelp={onHelp}
      />
      {/* OfflineChip mounts here later (top-right on desktop belongs to the
          chip itself; this slot is the phone position, under the top bar). */}
      {offlineSlot ? <div className="border-b border-k-grey bg-k-white">{offlineSlot}</div> : null}
      <div className="flex flex-1">
        <NavRail approvalsCount={approvalsCount} />
        <main
          id="main-content"
          className="min-w-0 flex-1 overflow-x-hidden p-s-4 pb-[calc(56px+var(--s-4))] tablet:p-s-8 tablet:pb-s-8"
        >
          {children}
        </main>
      </div>
      <BottomTabBar approvalsCount={approvalsCount} />
    </div>
  );
}
