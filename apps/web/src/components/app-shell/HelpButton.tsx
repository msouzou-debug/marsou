"use client";

import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useHelp } from "@/help/HelpProvider";

export interface HelpButtonProps {
  /** @deprecated The button now opens the S25 drawer itself via
   *  `useHelp()`. Kept so `TopBar`/`AppShell`'s existing `onHelp` prop stays
   *  source-compatible; when supplied it still fires alongside `open()`. */
  onHelp?: () => void;
}

export function HelpButton({ onHelp }: HelpButtonProps) {
  const t = useTranslations("common");
  const { open } = useHelp();
  return (
    <button
      type="button"
      onClick={() => {
        open();
        onHelp?.();
      }}
      className="flex shrink-0 items-center gap-s-2 rounded-k px-s-2 py-s-1 text-fs-14 text-k-text hover:bg-k-surface"
    >
      <CircleHelp size={20} strokeWidth={1.5} aria-hidden="true" />
      <span className="hidden tablet:inline">{t("help")}</span>
      <span className="sr-only tablet:hidden">{t("help")}</span>
    </button>
  );
}
