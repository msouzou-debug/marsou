"use client";

import { useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/format";

export interface TimelineEntry {
  id: string;
  actor: string;
  action: string;
  timestamp: string | number | Date;
  diff?: string;
}

/**
 * Timeline — vertical, read-only audit trail, newest at top
 * (UI instructions §4 Timeline).
 *
 * | Prop    | Type            | Notes                                          |
 * |---------|-----------------|--------------------------------------------------|
 * | entries | TimelineEntry[] | actor, action verb, timestamp, optional diff line |
 * | loading | boolean         | Shows skeleton rows                               |
 *
 * Entries are sorted newest-first here so callers do not each have to
 * remember the ordering rule; timestamps render through `formatDateTime`
 * (UI instructions — never format a date inline), in mono.
 *
 * States: default, loading (skeleton rows), empty
 * («Δεν υπάρχουν καταχωρήσεις ακόμη.»). Error/offline/noPermission belong to
 * whatever screen loads the entries, not to this read-only list.
 */
export interface TimelineProps {
  entries: TimelineEntry[];
  loading?: boolean;
}

export function Timeline({ entries, loading = false }: TimelineProps) {
  const t = useTranslations();

  if (loading) {
    return (
      <ul className="grid gap-s-4" aria-busy="true" aria-label={t("common.loading")}>
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex gap-s-3" aria-hidden="true">
            <div className="h-s-4 w-s-4 shrink-0 rounded-full bg-k-grey animate-pulse" />
            <div className="flex-1">
              <div className="h-s-3 w-2/3 animate-pulse rounded-k-chip bg-k-grey" />
              <div className="mt-s-2 h-s-3 w-1/3 animate-pulse rounded-k-chip bg-k-grey" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (entries.length === 0) {
    return <p className="text-fs-14 text-k-text">{t("components.timeline.empty")}</p>;
  }

  const sorted = [...entries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <ul className="grid gap-s-4">
      {sorted.map((entry) => (
        <li key={entry.id} className="flex gap-s-3 border-l-2 border-k-grey pl-s-3">
          <div>
            <p className="text-fs-14 text-k-ink">
              <span className="font-bold">{entry.actor}</span> {entry.action}
            </p>
            <p className="num text-fs-12 text-k-text-muted">{formatDateTime(entry.timestamp)}</p>
            {entry.diff && <p className="mt-s-1 text-fs-12 text-k-text">{entry.diff}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
