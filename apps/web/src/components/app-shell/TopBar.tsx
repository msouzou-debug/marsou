import { LogOut, Search, User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Me, OrgUnit } from "@ecapital/shared";
import { selectUnit, signOut } from "@/auth/actions";
import { HelpButton } from "./HelpButton";
import { LanguageToggle } from "./LanguageToggle";
import { UnitSwitcher } from "./UnitSwitcher";

export interface TopBarProps {
  orgUnits: OrgUnit[];
  defaultOrgUnitId?: string;
  me?: Me;
  onHelp?: () => void;
}

// 56px top bar (UI instructions §2): logo · unit switcher · search · language
// · user · help. On phone (<1024) the wordmark, the search box and the
// language toggle drop out; the name and Αποσύνδεση stay, because signing out
// on a shared ward terminal is exactly the thing that must not need a wider
// screen. Below 1440 both shrink to what fits — the name truncates and the
// sign-out label becomes its icon plus a screen-reader label — so the bar
// never pushes the page into a horizontal scroll (RULE, UI instructions §2).
export async function TopBar({ orgUnits, defaultOrgUnitId, me, onHelp }: TopBarProps) {
  const t = await getTranslations();
  const userName = me?.name ?? t("common.user");

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-s-2 border-b border-k-grey bg-k-white px-s-4 tablet:gap-s-4 tablet:px-s-6">
      <Link href="/" className="flex shrink-0 items-center gap-s-2" aria-label={t("shell.logoHome")}>
        <Image src="/brand/okypy_icon.png" alt="" width={28} height={28} className="h-7 w-7" priority />
        <span className="hidden text-fs-16 font-bold text-k-blue-deep tablet:inline">eCapital</span>
      </Link>

      <UnitSwitcher orgUnits={orgUnits} defaultUnitId={defaultOrgUnitId} onSelect={selectUnit} />

      <div className="hidden flex-1 tablet:block">
        <label className="relative block max-w-[360px]">
          <Search
            size={20}
            strokeWidth={1.5}
            aria-hidden="true"
            className="pointer-events-none absolute left-s-2 top-1/2 -translate-y-1/2 text-k-text-muted"
          />
          <span className="sr-only">{t("common.search")}</span>
          <input
            type="search"
            placeholder={t("common.search")}
            className="w-full rounded-k border border-k-grey bg-k-white py-s-1 pl-s-8 pr-s-2 text-fs-14 text-k-text"
          />
        </label>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-s-1 tablet:gap-s-4">
        <div className="hidden tablet:block">
          <LanguageToggle />
        </div>
        <div className="flex min-w-0 items-center gap-s-2 text-fs-14 text-k-text">
          <User size={20} strokeWidth={1.5} aria-hidden="true" className="hidden shrink-0 tablet:block" />
          <span
            title={t("shell.account", { name: userName })}
            className="max-w-[92px] truncate desktop:max-w-none"
          >
            {userName}
          </span>
        </div>
        {me ? (
          <form action={signOut}>
            <button
              type="submit"
              className="flex h-11 shrink-0 items-center gap-s-2 rounded-k px-s-2 text-fs-14 text-k-text hover:bg-k-surface"
            >
              <LogOut size={20} strokeWidth={1.5} aria-hidden="true" />
              <span className="hidden desktop:inline">{t("buttons.signOut")}</span>
              <span className="sr-only desktop:hidden">{t("buttons.signOut")}</span>
            </button>
          </form>
        ) : null}
        <HelpButton onHelp={onHelp} />
      </div>
    </header>
  );
}
