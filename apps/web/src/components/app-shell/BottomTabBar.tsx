"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { AppRole } from "@ecapital/shared";
import { LanguageToggle } from "./LanguageToggle";
import { moreSheetItems, phoneTabItems } from "./nav-items";

export interface BottomTabBarProps {
  /** Count for the Εγκρίσεις (approvals) badge. 0 hides the badge. */
  approvalsCount?: number;
  /** `me.roles` — same gate `NavRail` applies to a `visibleFor` item. */
  roles?: AppRole[];
}

// Phone only (<1024): 4 tabs, 56px tall, 44px minimum touch targets (UI
// instructions §2, §7). The 4th slot opens a sheet with the remaining nav
// items plus the language toggle, since a phone screen has no room for all
// nine sections.
export function BottomTabBar({ approvalsCount = 0, roles = [] }: BottomTabBarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const visibleMoreItems = moreSheetItems.filter((item) => !item.visibleFor || item.visibleFor(roles));

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <nav
        aria-label={t("shell.primaryNav")}
        className="fixed inset-x-0 bottom-0 z-20 flex h-14 border-t border-k-grey bg-k-white tablet:hidden"
      >
        {phoneTabItems.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : (pathname ?? "").startsWith(item.href);
          const badge = item.hasBadge && approvalsCount > 0 ? approvalsCount : undefined;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-fs-12 ${
                active ? "text-k-blue-deep" : "text-k-text"
              }`}
            >
              <span className="relative inline-flex">
                <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
                {badge ? (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1.5 -top-1.5 flex min-w-[16px] items-center justify-center rounded-full bg-k-ink px-1 text-fs-12 leading-[16px] text-k-white"
                  >
                    {badge}
                  </span>
                ) : null}
              </span>
              <span>
                {t(item.labelKey)}
                {badge ? (
                  <span className="sr-only"> — {t("shell.approvalsWaiting", { count: badge })}</span>
                ) : null}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-fs-12 text-k-text"
        >
          <Menu size={24} strokeWidth={1.5} aria-hidden="true" />
          <span>{t("shell.more")}</span>
        </button>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-30 tablet:hidden">
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-k-ink/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.moreSheetLabel")}
            className="absolute inset-x-0 bottom-0 rounded-t-k bg-k-white p-s-4 shadow-k"
          >
            <div className="mb-s-4 flex items-center justify-between">
              <p className="eyebrow">{t("shell.moreSheetLabel")}</p>
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => setOpen(false)}
                className="rounded-k p-s-1 text-k-text hover:bg-k-surface"
              >
                <X size={20} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
            <ul className="grid gap-s-1">
              {visibleMoreItems.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex min-h-11 items-center gap-s-3 rounded-k px-s-3 py-s-2 text-fs-16 text-k-text hover:bg-k-surface"
                    >
                      <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
                      {t(item.labelKey)}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-s-4 flex items-center justify-between border-t border-k-grey pt-s-4">
              <span className="text-fs-14 text-k-text">{t("common.language")}</span>
              <LanguageToggle />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
