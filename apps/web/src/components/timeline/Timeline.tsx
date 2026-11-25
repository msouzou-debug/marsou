"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp } from "lucide-react";
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
 * | Prop        | Type            | Notes                                          |
 * |-------------|-----------------|--------------------------------------------------|
 * | entries     | TimelineEntry[] | actor, action verb, timestamp, optional diff line |
 * | loading     | boolean         | Shows skeleton rows (or a busy toggle while closed) |
 * | defaultOpen | boolean         | Default `false`: the list starts collapsed         |
 *
 * Entries are sorted newest-first here so callers do not each have to
 * remember the ordering rule; timestamps render through `formatDateTime`
 * (UI instructions — never format a date inline), in mono.
 *
 * RULE (UAT 25/11/2026): the history starts collapsed, behind one button
 * «Εμφάνιση ιστορικού (N)» / «Απόκρυψη ιστορικού». A record page is read
 * for its facts; the trail of who changed what is there when asked for,
 * not a wall of entries pushing the facts off the screen. The button is a
 * native `<button>` with `aria-expanded` and `aria-controls`, so Tab, Enter
 * and Space work and a screen reader says whether the list is open. Every
 * screen that shows a Timeline (S03, S11, S17, S18a) gets this from here;
 * `defaultOpen` is for the rare one that wants the list open.
 *
 * States: default, loading (skeleton rows), empty
 * («Δεν υπάρχουν καταχωρίσεις ακόμη.», no button: there is nothing to
 * open). Error/offline/noPermission belong to whatever screen loads the
 * entries, not to this read-only list.
 */
export interface TimelineProps {
  entries: TimelineEntry[];
  loading?: boolean;
  defaultOpen?: boolean;
}

const TOGGLE =
  "inline-flex min-h-[44px] items-center gap-s-1 rounded-k text-fs-14 text-k-blue-deep underline-offset-2 hover:underline disabled:opacity-50 print:hidden";

export function Timeline({ entries, loading = false, defaultOpen = false }: TimelineProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(defaultOpen);
  const listId = useId();

  if (loading && !open) {
    return (
      <button type="button" className={TOGGLE} disabled aria-busy="true" aria-expanded={false}>
        <ChevronDown size={20} strokeWidth={1.5} aria-hidden="true" />
        {t("common.loading")}
      </button>
    );
  }

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
    <div>
      <button
        type="button"
        className={TOGGLE}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronUp size={20} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronDown size={20} strokeWidth={1.5} aria-hidden="true" />
        )}
        {open ? t("components.timeline.hide") : t("components.timeline.show", { count: sorted.length })}
      </button>
      <ul id={listId} className="mt-s-3 grid gap-s-4" hidden={!open}>
        {open &&
          sorted.map((entry) => (
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
    </div>
  );
}
