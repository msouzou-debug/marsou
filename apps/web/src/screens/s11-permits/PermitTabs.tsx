"use client";

/**
 * PermitTabs — the tab strip at the top of «Διακοπές και άδειες»: Άδειες
 * (S11, `/permits`) and Ημερολόγιο διαταράξεων (S15, `/calendar`) — item 7's
 * "put it under «Διακοπές και άδειες» as a tab". Same pattern as
 * `CostNavTabs`/`AdminTabs`: real links with `aria-current`, not buttons
 * swapping a panel.
 *
 * State: default only — it holds no data of its own.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";

export interface PermitTabsProps {
  active: "permits" | "calendar";
}

export function PermitTabs({ active }: PermitTabsProps) {
  const t = useTranslations("components.permit-tabs");

  const tabs = [
    { id: "permits" as const, href: "/permits", label: t("permits") },
    { id: "calendar" as const, href: "/calendar", label: t("calendar") },
  ];

  return (
    <nav aria-label={t("label")} className="mb-s-5 border-b border-k-grey">
      <ul className="flex flex-wrap gap-s-1">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <Link
              href={tab.href}
              aria-current={active === tab.id ? "page" : undefined}
              className={
                active === tab.id
                  ? "flex min-h-[44px] items-center border-b-2 border-k-blue px-s-4 text-fs-16 font-bold text-k-blue-deep"
                  : "flex min-h-[44px] items-center border-b-2 border-transparent px-s-4 text-fs-16 text-k-text hover:text-k-ink"
              }
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
