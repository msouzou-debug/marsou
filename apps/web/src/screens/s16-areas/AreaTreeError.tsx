"use client";

// S16 (lite) — R01

/**
 * The error state of the area tree (UI instructions §6): what happened, what
 * to do, and a retry that re-runs the server fetch. `router.refresh()` is the
 * retry here because the tree is fetched on the server with the caller's
 * bearer — there is no client-side query to invalidate.
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";

export function AreaTreeError() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-k border border-k-grey bg-k-white p-s-6">
      <p className="text-fs-16 text-k-text">{t("states.error.loadFailed")}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
        className="mt-s-4 h-11 rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white disabled:opacity-60"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
