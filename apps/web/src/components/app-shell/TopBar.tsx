import { Search, User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { OrgUnit } from "@ecapital/shared";
import { HelpButton } from "./HelpButton";
import { LanguageToggle } from "./LanguageToggle";
import { UnitSwitcher } from "./UnitSwitcher";

export interface TopBarProps {
  orgUnits: OrgUnit[];
  defaultOrgUnitId?: string;
  userName?: string;
  onHelp?: () => void;
}

// 56px top bar (UI instructions §2): logo · unit switcher · search · language
// · user · help. Shrinks to logo + unit + help on phone (<1024) — search and
// the user name move into the "more" sheet's screen real estate instead.
export async function TopBar({ orgUnits, defaultOrgUnitId, userName, onHelp }: TopBarProps) {
  const t = await getTranslations();
  const resolvedUserName = userName ?? t("common.user");

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-s-4 border-b border-k-grey bg-k-white px-s-4 tablet:px-s-6">
      <Link href="/" className="flex shrink-0 items-center gap-s-2" aria-label={t("shell.logoHome")}>
        <Image src="/brand/okypy_icon.png" alt="" width={28} height={28} className="h-7 w-7" priority />
        <span className="text-fs-16 font-bold text-k-blue-deep">eCapital</span>
      </Link>

      <UnitSwitcher orgUnits={orgUnits} defaultUnitId={defaultOrgUnitId} />

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

      <div className="ml-auto flex shrink-0 items-center gap-s-2 tablet:gap-s-4">
        <div className="hidden tablet:block">
          <LanguageToggle />
        </div>
        <div className="hidden items-center gap-s-2 text-fs-14 text-k-text tablet:flex">
          <User size={20} strokeWidth={1.5} aria-hidden="true" />
          <span>{resolvedUserName}</span>
        </div>
        <HelpButton onHelp={onHelp} />
      </div>
    </header>
  );
}
