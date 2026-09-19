"use client";

/**
 * AdminTabs — the tab strip at the top of Διαχείριση (S24).
 *
 * | Prop | Type   | Notes                                    |
 * |------|--------|------------------------------------------|
 * | —    | —      | The current tab comes from `usePathname()`. |
 *
 * RULE (ADR-0020): Διαχείριση has two things in it now — «Χρήστες», which is
 * the new one and the one the nav lands on, and «Ανάδοχοι», which was the
 * whole of the area until today and keeps its own route. Each tab is a real
 * link, so the browser's back button and a copied URL both work; the strip is
 * a `<nav>` with `aria-current` on the tab you are on, not a set of buttons
 * that swap a panel.
 *
 * State: default only — it holds no data of its own.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

interface AdminTab {
  href: string;
  labelKey: "users" | "contractors";
}

const TABS: AdminTab[] = [
  { href: "/admin/users", labelKey: "users" },
  { href: "/admin/contractors", labelKey: "contractors" },
];

export function AdminTabs() {
  const t = useTranslations("components.admin-tabs");
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")} className="mb-s-5 border-b border-k-grey">
      <ul className="flex flex-wrap gap-s-1">
        {TABS.map((tab) => {
          const current = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={
                  current
                    ? "flex min-h-[44px] items-center border-b-2 border-k-blue px-s-4 text-fs-16 font-bold text-k-blue-deep"
                    : "flex min-h-[44px] items-center border-b-2 border-transparent px-s-4 text-fs-16 text-k-text hover:text-k-ink"
                }
              >
                {t(tab.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
