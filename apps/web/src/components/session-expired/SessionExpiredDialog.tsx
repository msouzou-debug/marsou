"use client";

/**
 * SessionExpiredDialog — what an open page shows when its session has ended
 * (owner UAT 25/11/2026: «RFI save: Request to /contracts/<id>/rfis failed
 * with 401»). Mounted once, by `QueryProvider`; it listens for
 * `SESSION_EXPIRED_EVENT`, which `data/client.ts` raises on every 401 from a
 * query or a save.
 *
 * | Prop | Type | Notes                                                          |
 * |------|------|-----------------------------------------------------------------|
 * | —    | —    | No props. `initiallyOpen` exists for the preview and the tests. |
 *
 * RULE: the user is never moved off the page without being asked, because a
 * form on it may hold text that was not saved. The dialog says so and offers
 * three ways on:
 *   - «Σύνδεση» — the sign-in page, which comes back to this same page;
 *   - «Σύνδεση σε νέα καρτέλα» — the same, in a new tab, so this page and
 *     whatever was typed on it stay; back here, the same button works again
 *     because the new sign-in's cookie is shared by both tabs;
 *   - «Παραμονή στη σελίδα» (or Escape) — to copy the text first.
 *
 * States: default only — it holds no data of its own.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SESSION_EXPIRED_EVENT, signInHrefFor } from "@/data/session-expiry";

export interface SessionExpiredDialogProps {
  initiallyOpen?: boolean;
}

function here(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

export function SessionExpiredDialog({ initiallyOpen = false }: SessionExpiredDialogProps) {
  const t = useTranslations("session.expired");
  const [open, setOpen] = useState(initiallyOpen);
  const [href, setHref] = useState(() => signInHrefFor(here()));

  useEffect(() => {
    function onExpired() {
      setHref(signInHrefFor(here()));
      setOpen(true);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-k-ink/60 p-s-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-expired-title"
        aria-describedby="session-expired-unsaved"
        className="w-full max-w-[480px] rounded-k bg-k-white p-s-6 shadow-k"
      >
        <h2 id="session-expired-title" className="text-fs-20 font-bold text-k-ink">
          {t("title")}
        </h2>
        <p id="session-expired-unsaved" className="mt-s-3 text-fs-14 text-k-text">
          {t("unsaved")}
        </p>
        <div className="mt-s-5 flex flex-wrap items-center gap-s-3">
          <a href={href} className="flex h-11 items-center rounded-k bg-k-blue px-s-5 text-fs-14 font-bold text-k-white shadow-k">
            {t("signIn")}
          </a>
          <a
            href={href}
            target="_blank"
            rel="noopener"
            onClick={() => setOpen(false)}
            className="flex h-11 items-center rounded-k border border-k-grey px-s-5 text-fs-14 font-bold text-k-blue-deep"
          >
            {t("signInNewTab")}
          </a>
          <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-k px-s-5 text-fs-14 text-k-text">
            {t("stay")}
          </button>
        </div>
      </div>
    </div>
  );
}
