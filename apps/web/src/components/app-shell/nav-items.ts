import type { ComponentType } from "react";
import {
  BarChart3,
  Building2,
  Construction,
  FileSignature,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  Settings,
  Wrench,
} from "lucide-react";

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
    | "nav.approvals"
    | "nav.reports"
    | "nav.admin";
  icon: IconComponent;
  /** true for the one item that carries a count badge (Εγκρίσεις) */
  hasBadge?: boolean;
}

// UI instructions §2: fixed order, one Lucide icon each. Only "/" exists as a
// real route today — the rest may 404 until their screens ship, per the
// build brief's milestone order (M1-M6).
export const NAV_ITEMS: NavItem[] = [
  { id: "portfolio", href: "/", labelKey: "nav.portfolio", icon: LayoutDashboard },
  { id: "projects", href: "/projects", labelKey: "nav.projects", icon: FolderKanban },
  { id: "contracts", href: "/contracts", labelKey: "nav.contracts", icon: FileSignature },
  { id: "shutdowns", href: "/shutdowns", labelKey: "nav.shutdowns", icon: Construction },
  { id: "assets", href: "/assets", labelKey: "nav.assets", icon: Building2 },
  { id: "maintenance", href: "/maintenance", labelKey: "nav.maintenance", icon: Wrench },
  { id: "approvals", href: "/approvals", labelKey: "nav.approvals", icon: Inbox, hasBadge: true },
  { id: "reports", href: "/reports", labelKey: "nav.reports", icon: BarChart3 },
  { id: "admin", href: "/admin", labelKey: "nav.admin", icon: Settings },
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
