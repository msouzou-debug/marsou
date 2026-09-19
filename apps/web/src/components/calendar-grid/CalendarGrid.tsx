"use client";

import { TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { CalendarEntry } from "@ecapital/shared";
import { IcraBadge } from "@/components/icra-badge";
import type { Locale } from "@/i18n/config";
import { clashPartnerRef } from "@/lib/permit-rules";

/**
 * CalendarGrid — S15's network-wide disruption calendar: a month grid on
 * desktop, a list on phone, entries coloured by status with the ICRA class
 * as a small badge and a warning icon on a clash (UI instructions §5 S15,
 * CAPEX-01 §6.7).
 *
 * | Prop   | Type            | Notes                                                          |
 * |--------|-----------------|--------------------------------------------------------------------|
 * | year   | number          |                                                                     |
 * | month  | number          | 0-based, like `Date`.                                              |
 * | entries| CalendarEntry[] | Already filtered to the visible range/unit/area type/system.        |
 * | onOpen | (permitId) => void | Opens the permit (both the grid cell and the list row).         |
 *
 * RULE (§6.7): a clash never blocks — `hasClash` only adds a warning icon
 * with a tooltip naming the other permit (`clashPartnerRef`,
 * `src/lib/permit-rules.ts`); nothing here disables opening either permit.
 *
 * State: default, empty (no entries in the visible range).
 */
export interface CalendarGridProps {
  year: number;
  month: number;
  entries: CalendarEntry[];
  onOpen: (permitId: string) => void;
}

const STATUS_STYLE: Record<CalendarEntry["status"], string> = {
  DRAFT: "bg-k-grey text-k-ink",
  SUBMITTED: "bg-k-amber-bg text-k-ink",
  CLINICAL_REVIEW: "bg-k-amber-bg text-k-ink",
  APPROVED: "bg-k-blue-bg text-k-ink",
  ACTIVE: "bg-k-green-bg text-k-ink",
  BREACH: "bg-k-red text-k-white",
  CLOSED: "bg-k-grey text-k-text",
  REJECTED: "bg-k-red-bg text-k-ink",
};

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function entriesOnDay(entries: CalendarEntry[], year: number, month: number, day: number): CalendarEntry[] {
  const dayStart = new Date(year, month, day, 0, 0, 0);
  const dayEnd = new Date(year, month, day, 23, 59, 59);
  return entries.filter((e) => new Date(e.start) <= dayEnd && new Date(e.end) >= dayStart);
}

export function CalendarGrid({ year, month, entries, onOpen }: CalendarGridProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;

  if (entries.length === 0) {
    return <p className="p-s-8 text-center text-fs-16 text-k-text">{t("components.calendar-grid.empty")}</p>;
  }

  const total = daysInMonth(year, month);
  const days = Array.from({ length: total }, (_, i) => i + 1);
  const dayFormatter = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "el-GR", { day: "numeric" });

  function EntryPill({ entry }: { entry: CalendarEntry }) {
    const partner = clashPartnerRef(entry, entries);
    return (
      <button
        type="button"
        onClick={() => onOpen(entry.permitId)}
        title={entry.hasClash && partner ? t("components.calendar-grid.clashWith", { ref: partner }) : undefined}
        className={`flex w-full items-center gap-s-1 rounded-k-chip px-s-1 py-[2px] text-left text-fs-12 ${STATUS_STYLE[entry.status]}`}
      >
        {entry.hasClash && (
          <TriangleAlert size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-k-amber" />
        )}
        <span className="truncate">{entry.titleEl}</span>
        {entry.icraClass && <IcraBadge icraClass={entry.icraClass} size="list" />}
      </button>
    );
  }

  return (
    <>
      {/* Desktop/tablet: month grid. */}
      <div className="hidden tablet:grid tablet:grid-cols-7 tablet:gap-s-1">
        {days.map((day) => {
          const dayEntries = entriesOnDay(entries, year, month, day);
          return (
            <div key={day} className="min-h-[96px] rounded-k border border-k-grey p-s-1">
              <p className="num text-fs-12 text-k-text-muted">{dayFormatter.format(new Date(year, month, day))}</p>
              <div className="mt-s-1 grid gap-s-1">
                {dayEntries.map((entry) => (
                  <EntryPill key={entry.permitId} entry={entry} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Phone: a flat list, newest start first. */}
      <ul className="grid gap-s-2 tablet:hidden">
        {[...entries]
          .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
          .map((entry) => (
            <li key={entry.permitId}>
              <EntryPill entry={entry} />
            </li>
          ))}
      </ul>
    </>
  );
}
