"use client";

/**
 * CostNavTabs — the tab strip at the top of the «Κόστος» nav area (S10
 * Εισαγωγή SAP, S09a Δεδουλευμένα). Same pattern `AdminTabs` sets for
 * Διαχείριση: real links with `aria-current`, not buttons swapping a panel,
 * so back/forward and a copied URL both work.
 *
 * State: default only — it holds no data of its own.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

interface CostTab {
  href: string;
  labelKey: "imports" | "accruals";
}

const TABS: CostTab[] = [
  { href: "/cost/imports", labelKey: "imports" },
  { href: "/cost/accruals", labelKey: "accruals" },
];

export function CostNavTabs() {
  const t = useTranslations("components.cost-nav-tabs");
  const pathname = usePathname() ?? "";

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
