"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * HelpDrawer — S25 Βοήθεια, slides from the right over the current screen
 * (UI instructions §5 S25, §4). Never a modal, never a route change: it is a
 * plain positioned panel, not a `<dialog>`, so the page underneath stays live.
 *
 * | Prop            | Type       | Notes                                                        |
 * |-----------------|------------|------------------------------------------------------------------|
 * | open            | boolean    | Whether the drawer is showing                                    |
 * | onClose         | () => void | Close button and Esc                                             |
 * | onSearch        | (query: string) => void | Fired as the search box changes                   |
 * | children        | ReactNode? | Pre-rendered section for the current screen (2 sentences,        |
 * |                 |            | numbered steps, "Τι μπορεί να πάει λάθος"); omit for the empty    |
 * |                 |            | state. Rendering the manual's Markdown is the caller's job.       |
 * | role            | string     | Persona for the footer PDF-guide link ("help.pdfGuide")           |
 * | pdfHref         | string     | Href for that link                                                |
 * | helpCentreHref  | string     | Href for the empty-state "goToCentre" link                        |
 *
 * The scrim behind the drawer is 20% and, on desktop, `pointer-events: none`
 * so clicks still reach the screen underneath (UI instructions §5) — only
 * the drawer panel itself is interactive there. On phone the drawer is full
 * screen, so there is nothing behind it to protect.
 *
 * Reading typography per §5: 16px body, 1.6 line-height, 20px headings.
 *
 * States: default (a section is supplied), empty (no section yet — RULE:
 * shows help.unwritten plus a link to the help centre, never a blank drawer).
 */
export interface HelpDrawerProps {
  open: boolean;
  onClose: () => void;
  onSearch?: (query: string) => void;
  children?: ReactNode;
  role: string;
  pdfHref: string;
  helpCentreHref: string;
}

export function HelpDrawer({ open, onClose, onSearch, children, role, pdfHref, helpCentreHref }: HelpDrawerProps) {
  const t = useTranslations();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Scrim: visual dimming only. pointer-events: none on desktop so the
          screen underneath stays fully usable while the drawer is open. */}
      <div className="fixed inset-0 z-40 bg-k-ink/20 desktop:pointer-events-none" aria-hidden="true" />

      <aside
        aria-label={t("common.help")}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-k-white shadow-k desktop:w-[380px]"
      >
        <header className="flex items-center gap-s-3 border-b border-k-grey p-s-4">
          <h2 className="flex-1 text-fs-20">{t("common.help")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-k p-s-2 text-k-text hover:bg-k-surface"
          >
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </header>

        <div className="p-s-4">
          <input
            type="search"
            placeholder={t("help.searchPlaceholder")}
            onChange={(e) => onSearch?.(e.target.value)}
            className="w-full rounded-k border border-k-grey p-s-3 text-fs-16"
          />
        </div>

        <div className="flex-1 overflow-auto px-s-4 pb-s-4 text-fs-16 leading-[1.6] [&_h2]:text-fs-20 [&_h3]:text-fs-20">
          {children ?? (
            <div className="p-s-4 text-center">
              <p>{t("help.unwritten")}</p>
              <Link href={helpCentreHref} className="mt-s-3 inline-block text-k-blue underline-offset-2 hover:underline">
                {t("help.goToCentre")}
              </Link>
            </div>
          )}
        </div>

        <footer className="border-t border-k-grey p-s-4">
          {/* Opens in a new tab (R50): the drawer, and the page under it,
              stay exactly as the reader left them. */}
          <Link
            href={pdfHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fs-14 text-k-blue underline-offset-2 hover:underline"
          >
            {t("help.pdfGuide", { role })}
          </Link>
        </footer>
      </aside>
    </>
  );
}
