"use client";

import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";

export interface HelpButtonProps {
  /** Wired up once the help drawer (S25) exists. Undefined for now — the
   *  button is present and focusable, it just has nothing to open yet. */
  onHelp?: () => void;
}

export function HelpButton({ onHelp }: HelpButtonProps) {
  const t = useTranslations("common");
  return (
    <button
      type="button"
      onClick={() => onHelp?.()}
      className="flex shrink-0 items-center gap-s-2 rounded-k px-s-2 py-s-1 text-fs-14 text-k-text hover:bg-k-surface"
    >
      <CircleHelp size={20} strokeWidth={1.5} aria-hidden="true" />
      <span className="hidden tablet:inline">{t("help")}</span>
      <span className="sr-only tablet:hidden">{t("help")}</span>
    </button>
  );
}
