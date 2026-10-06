"use client";

// S18, S18a, S19 — R33 (ADR-0031 §3)
//
/**
 * WorkOrderTimer — one of an order's three contract timers, as S18's table,
 * S18a's large timers and S19 show it. Wraps `SlaChip` for a clock that is
 * still running and says the outcome once the clock stopped.
 *
 * | Prop     | Type             | Notes                                                                 |
 * |----------|------------------|-----------------------------------------------------------------------|
 * | dueAt    | string \| null   | The deadline the API stamped on the order. Null: no such timer («—»).  |
 * | metAt    | string \| null   | When the clock stopped (responded, restored, report received).        |
 * | startAt  | string           | `calledAt`: every timer counts from the call (contract note *).       |
 * | state    | SlaState \| null | The API's own state for this timer (`WorkOrder.sla`).                  |
 * | stopped  | boolean?         | The order is cancelled: no clock runs, nothing was met.               |
 *
 * RULE (ADR-0031 §3): a running timer is `SlaChip` with the full timer
 * length (`dueAt − calledAt`), so its «Απομένουν…» text stays live. A met
 * timer stops ticking and reads «Εντός χρόνου» or «Εκπρόθεσμα» from the
 * API's state (BREACHED = met late), never recomputed here. Same idea as
 * S07b, where the answered date replaces the SlaChip.
 *
 * State: default only — it renders values its parent already holds.
 */
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import type { SlaState, WorkOrderListRow } from "@ecapital/shared";
import { SlaChip } from "@/components/sla-chip";
import { formatDate } from "@/lib/format";

export interface WorkOrderTimerProps {
  dueAt: string | null;
  metAt: string | null;
  startAt: string;
  state: SlaState | null;
  stopped?: boolean;
}

export function WorkOrderTimer({ dueAt, metAt, startAt, state, stopped = false }: WorkOrderTimerProps) {
  const t = useTranslations("screens.s18.timer");
  if (!dueAt || stopped) return <span className="text-fs-14 text-k-text">—</span>;
  if (metAt) {
    const late = state === "BREACHED" || Date.parse(metAt) > Date.parse(dueAt);
    return (
      <span
        className={`inline-flex items-center whitespace-nowrap rounded-k-chip px-s-2 py-s-1 text-fs-14 ${late ? "bg-k-red text-k-white" : "bg-k-green-bg text-k-ink"}`}
      >
        {late ? t("metLate") : t("metOnTime")}
      </span>
    );
  }
  const totalHours = Math.max((Date.parse(dueAt) - Date.parse(startAt)) / 3_600_000, 0.01);
  return <SlaChip dueAt={dueAt} totalHours={totalHours} />;
}

const PM_STYLE: Record<SlaState, string> = {
  GREEN: "bg-k-green-bg text-k-ink",
  AMBER: "bg-k-amber-bg text-k-ink",
  RED: "bg-k-red text-k-white",
  BREACHED: "bg-k-red-bg text-k-ink",
};

/**
 * RULE (ADR-0031 §3): a PM order has one deadline, its programme date, in
 * the restore slot. It is a date, not an hour count, so it shows the date
 * itself coloured by the API's state rather than a ticking countdown.
 */
export function PmDueChip({ dueDate, state, done }: { dueDate: string | null; state: SlaState | null; done: boolean }) {
  const t = useTranslations("screens.s18.timer");
  if (!dueDate) return <span className="text-fs-14 text-k-text">—</span>;
  const style = done ? "bg-k-grey text-k-ink" : PM_STYLE[state ?? "GREEN"];
  return (
    <span className={`num inline-flex items-center whitespace-nowrap rounded-k-chip px-s-2 py-s-1 text-fs-14 ${style}`}>
      {t("pmDue", { date: formatDate(dueDate) })}
    </span>
  );
}

/** The three timers of one list row, in column order. */
export function rowTimers(row: WorkOrderListRow) {
  const stopped = row.status === "CANCELLED";
  return {
    response: <WorkOrderTimer dueAt={row.dueResponseAt} metAt={row.respondedAt} startAt={row.calledAt} state={row.sla.response} stopped={stopped} />,
    restore:
      row.kind === "PM" ? (
        <PmDueChip dueDate={row.dueDate} state={row.sla.restore} done={row.completedAt !== null || stopped} />
      ) : (
        <WorkOrderTimer dueAt={row.dueRestoreAt} metAt={row.restoredAt} startAt={row.calledAt} state={row.sla.restore} stopped={stopped} />
      ),
    report:
      row.kind === "PM" ? (
        <span className="text-fs-14 text-k-text">—</span>
      ) : (
        <WorkOrderTimer dueAt={row.dueReportAt} metAt={row.completedAt} startAt={row.calledAt} state={row.sla.report} stopped={stopped} />
      ),
  };
}

export function EscalatedMark() {
  const t = useTranslations("screens.s18");
  return (
    <span className="inline-flex items-center gap-s-1 whitespace-nowrap rounded-k-chip bg-k-red-bg px-s-2 py-s-1 text-fs-14 text-k-ink">
      <TriangleAlert size={20} strokeWidth={1.5} aria-hidden="true" className="text-k-red" />
      {t("escalated")}
    </span>
  );
}
