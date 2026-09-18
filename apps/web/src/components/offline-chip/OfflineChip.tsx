"use client";

import { CircleAlert, RefreshCw, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * OfflineChip — eCapital UI instructions §4. Reuses the existing
 * `states.offline.*` i18n keys rather than adding new ones.
 *
 * | Prop     | Type                                              | Notes                                  |
 * |----------|-----------------------------------------------------|-----------------------------------------|
 * | status   | "online" \| "offline" \| "syncing" \| "failed"       | Connectivity / sync state.               |
 * | queued   | number                                               | Records waiting to sync.                 |
 * | onRetry  | () => void?                                          | Shown as a link in the "failed" state.   |
 *
 * State: default only — OfflineChip mirrors a connectivity signal the app
 * shell already tracks; it has no fetch of its own to be loading, empty,
 * unauthorised or offline "about".
 *
 * RULE: never hidden while anything is queued. `status === "online"` with
 * `queued > 0` is a real, tested case (writes made offline, not yet synced
 * once the connection returns) and still renders the amber queued message.
 */

export type OfflineStatus = "online" | "offline" | "syncing" | "failed";

export interface OfflineChipProps {
  status: OfflineStatus;
  queued: number;
  onRetry?: () => void;
}

export function OfflineChip({ status, queued, onRetry }: OfflineChipProps) {
  const t = useTranslations();

  if (status === "syncing") {
    return (
      <span className="inline-flex items-center gap-s-2 rounded-k-chip bg-k-blue-bg px-s-3 py-s-2 text-fs-14 text-k-ink">
        <RefreshCw aria-hidden="true" size={20} strokeWidth={1.5} className="text-k-blue" />
        <span>{t("states.offline.syncing")}</span>
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-s-2 rounded-k-chip bg-k-red px-s-3 py-s-2 text-fs-14 text-k-white">
        <CircleAlert aria-hidden="true" size={20} strokeWidth={1.5} />
        <span>{t("states.offline.failed", { count: queued })}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="text-fs-14 text-k-white underline underline-offset-2">
            {t("states.offline.retry")}
          </button>
        )}
      </span>
    );
  }

  // RULE: covers status "offline" and the "online with a queue still draining"
  // edge case — both keep the queued message on screen.
  if (status === "offline" || queued > 0) {
    return (
      <span className="inline-flex items-center gap-s-2 rounded-k-chip bg-k-amber-bg px-s-3 py-s-2 text-fs-14 text-k-ink">
        <WifiOff aria-hidden="true" size={20} strokeWidth={1.5} className="text-k-amber" />
        <span>{t("states.offline.queued", { count: queued })}</span>
      </span>
    );
  }

  return null; // online, nothing queued: hidden
}
