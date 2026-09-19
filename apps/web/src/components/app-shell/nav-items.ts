import type { ComponentType } from "react";
import {
  BarChart3,
  Building2,
  Construction,
  FileSignature,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  Receipt,
  Settings,
  Wrench,
} from "lucide-react";
import type { AppRole } from "@ecapital/shared";
import { canViewCostNav } from "@/auth/roles";

type IconComponent = ComponentType<{
  size?: number | string;
  strokeWidth?: number;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

export interface NavItem {
  /** kebab-case, also used as the React key */
  id: string;
  href: string;
  /** key into nav.* in el.json / en.json */
  labelKey:
    | "nav.portfolio"
    | "nav.projects"
    | "nav.contracts"
    | "nav.shutdowns"
    | "nav.assets"
    | "nav.maintenance"
    | "nav.cost"
    | "nav.approvals"
    | "nav.reports"
    | "nav.admin";
  icon: IconComponent;
  /** true for the one item that carries a count badge (Εγκρίσεις) */
  hasBadge?: boolean;
  /** Omitted: visible to everyone. Present: shown only when it returns true for the caller's roles (M2's «Κόστος», the only nav entry a role can be shut out of). */
  visibleFor?: (roles: AppRole[]) => boolean;
}

// UI instructions §2: fixed order, one Lucide icon each. Only "/" exists as a
// real route today — the rest may 404 until their screens ship, per the
// build brief's milestone order (M1-M6).
export const NAV_ITEMS: NavItem[] = [
  { id: "portfolio", href: "/", labelKey: "nav.portfolio", icon: LayoutDashboard },
  { id: "projects", href: "/projects", labelKey: "nav.projects", icon: FolderKanban },
  { id: "contracts", href: "/contracts", labelKey: "nav.contracts", icon: FileSignature },
  // M3 (R19–R25): «Διακοπές και άδειες» — S11 permits list, with S15's
  // calendar as a second tab under it (`PermitTabs`).
  { id: "shutdowns", href: "/permits", labelKey: "nav.shutdowns", icon: Construction },
  { id: "assets", href: "/assets", labelKey: "nav.assets", icon: Building2 },
  { id: "maintenance", href: "/maintenance", labelKey: "nav.maintenance", icon: Wrench },
  // M2 (R14, R18): groups S10 Εισαγωγή SAP and S09a Δεδουλευμένα
  // (`CostNavTabs`). Visible only to a caller who can reach at least one of
  // the two — `canViewCostNav` (`@/auth/roles`) — the only nav entry this
  // build gates by role rather than leaving to the page's own NoPermission,
  // since every other item's screen is either open to everyone who has a
  // reason to browse it or simply does not exist yet.
  { id: "cost", href: "/cost/imports", labelKey: "nav.cost", icon: Receipt, visibleFor: canViewCostNav },
  { id: "approvals", href: "/approvals", labelKey: "nav.approvals", icon: Inbox, hasBadge: true },
  { id: "reports", href: "/reports", labelKey: "nav.reports", icon: BarChart3 },
  // RULE (ADR-0020): «Διαχείριση» lands on Χρήστες, which is the first tab
  // and the reason most people open the area at all. Ανάδοχοι is the second
  // tab and keeps its own route.
  { id: "admin", href: "/admin/users", labelKey: "nav.admin", icon: Settings },
];

// Phone bottom tab bar: 4 slots total. Three come from the rail, in this
// fixed order; the 4th slot is always "more" (UI instructions §2).
export const PHONE_TAB_IDS = ["portfolio", "approvals", "maintenance"] as const;

export const phoneTabItems = NAV_ITEMS.filter((item) =>
  (PHONE_TAB_IDS as readonly string[]).includes(item.id),
);

export const moreSheetItems = NAV_ITEMS.filter(
  (item) => !(PHONE_TAB_IDS as readonly string[]).includes(item.id),
);
