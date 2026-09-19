"use client";

// S15 — R25
//
/**
 * Calendar — the pure S15 screen body: the disruption-hours table above a
 * month `CalendarGrid`, filtered by unit / area type / system (UI
 * instructions §5 item 7).
 *
 * | Prop            | Type              | Notes                                                        |
 * |-----------------|-------------------|------------------------------------------------------------------|
 * | entries         | CalendarEntry[]?  | Ignored in `noPermission` \| `loading` \| `error`.                 |
 * | hours           | DisruptionHoursRow[]? |                                                                |
 * | state           | CalendarScreenState |                                                                 |
 * | year / month    | number            | 0-based month, like `Date`.                                     |
 * | onMonthChange   | (year, month) => void |                                                              |
 * | filters/onFilters | —               | unit / area type / system.                                      |
 * | orgUnits        | OrgUnit[]         |                                                                  |
 * | onOpenPermit    | (id) => void      |                                                                  |
 * | onRetry / noPermission | —          |                                                                  |
 */
import { useTranslations } from "next-intl";
import type { AreaType, CalendarEntry, DisruptionHoursRow, OrgUnit, PermitSystem } from "@ecapital/shared";
import { AreaType as AreaTypeEnum, PermitSystem as PermitSystemEnum } from "@ecapital/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageTitle } from "@/components/app-shell";
import { CalendarGrid } from "@/components/calendar-grid";
import { PermitTabs } from "@/screens/s11-permits/PermitTabs";
import { DisruptionHoursTable } from "./DisruptionHoursTable";
import type { TableState } from "@/components/table";
import type { ReactNode } from "react";

export type CalendarScreenState = "default" | "loading" | "error" | "noPermission" | "offline";

export interface CalendarFilters {
  orgUnitId: string;
  areaType: AreaType | "";
  system: PermitSystem | "";
}

export interface CalendarProps {
  entries?: CalendarEntry[];
  hours?: DisruptionHoursRow[];
  state: CalendarScreenState;
  hoursState: TableState;
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  filters: CalendarFilters;
  onFilters: (next: CalendarFilters) => void;
  orgUnits: OrgUnit[];
  onOpenPermit: (id: string) => void;
  onRetry?: () => void;
  noPermission: ReactNode;
}

const MONTH_KEYS = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

export function Calendar({
  entries,
  hours,
  state,
  hoursState,
  year,
  month,
  onMonthChange,
  filters,
  onFilters,
  orgUnits,
  onOpenPermit,
  onRetry,
  noPermission,
}: CalendarProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  function prevMonth() {
    onMonthChange(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);
  }
  function nextMonth() {
    onMonthChange(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1);
  }

  return (
    <>
      <PageTitle eyebrow={t("nav.shutdowns")} title={t("screens.s15.title")} tabs={<PermitTabs active="calendar" />} />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <section className="mb-s-6">
        <h2 className="mb-s-2 text-fs-20 text-k-blue-deep">{t("screens.s15.hoursTitle")}</h2>
        <DisruptionHoursTable rows={hours ?? []} state={hoursState} onExport={() => undefined} />
      </section>

      <div className="mb-s-4 flex flex-wrap items-center gap-s-3">
        <div className="flex items-center gap-s-2">
          <button type="button" onClick={prevMonth} aria-label={t("screens.s11.prevPage")} className="rounded-k border border-k-grey p-s-1 text-k-blue-deep">
            <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <p className="text-fs-16 font-bold text-k-ink">{t(`screens.s15.months.${MONTH_KEYS[month]}`)} {year}</p>
          <button type="button" onClick={nextMonth} aria-label={t("screens.s11.nextPage")} className="rounded-k border border-k-grey p-s-1 text-k-blue-deep">
            <ChevronRight size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
          {t("common.unit")}
          <select value={filters.orgUnitId} onChange={(e) => onFilters({ ...filters, orgUnitId: e.target.value })} className="rounded-k border border-k-grey p-s-2 text-fs-14">
            <option value="">{t("screens.s11.filters.all")}</option>
            {orgUnits.map((u) => (
              <option key={u.id} value={u.id}>{u.nameEl}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
          {t("screens.s15.filters.areaType")}
          <select value={filters.areaType} onChange={(e) => onFilters({ ...filters, areaType: e.target.value as AreaType | "" })} className="rounded-k border border-k-grey p-s-2 text-fs-14">
            <option value="">{t("screens.s11.filters.all")}</option>
            {AreaTypeEnum.options.map((a) => (
              <option key={a} value={a}>{t(`areaType.${a}`)}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
          {t("screens.s11.filters.system")}
          <select value={filters.system} onChange={(e) => onFilters({ ...filters, system: e.target.value as PermitSystem | "" })} className="rounded-k border border-k-grey p-s-2 text-fs-14">
            <option value="">{t("screens.s11.filters.all")}</option>
            {PermitSystemEnum.options.map((s) => (
              <option key={s} value={s}>{t(`permitSystem.${s}`)}</option>
            ))}
          </select>
        </label>
      </div>

      {state === "loading" ? (
        <div aria-busy="true" className="h-[400px] animate-pulse rounded-k bg-k-grey" />
      ) : state === "error" ? (
        <div className="p-s-8 text-center">
          <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep">
              {t("common.retry")}
            </button>
          )}
        </div>
      ) : (
        <CalendarGrid year={year} month={month} entries={entries ?? []} onOpen={onOpenPermit} />
      )}
    </>
  );
}
