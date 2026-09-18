"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * SlaChip — eCapital UI instructions §4.
 *
 * | Prop        | Type   | Notes                                                             |
 * |-------------|--------|--------------------------------------------------------------------|
 * | dueAt       | string | ISO timestamp the SLA is due at.                                   |
 * | totalHours  | number | The SLA's full length in hours, used to compute the remaining share.|
 *
 * State: default only — an SlaChip reflects a due date its parent already
 * has, so it has no loading, empty, no-permission or offline state of its own.
 *
 * RULE: ticks once a minute, not every second — a single `setInterval` of
 * 60 000 ms drives the re-render, and it is cleared on unmount.
 */

export type SlaLevel = "green" | "amber" | "red" | "breached";

export interface SlaChipProps {
  dueAt: string;
  totalHours: number;
}

/** Pure: the remaining-time band for a due date, unit-tested on its own. */
export function slaState(dueAt: string, totalHours: number, now: Date): SlaLevel {
  const remainingMs = new Date(dueAt).getTime() - now.getTime();
  if (remainingMs <= 0) return "breached";
  const totalMs = totalHours * 3_600_000;
  if (!(totalMs > 0)) return "breached"; // guards against a non-positive SLA length
  const remainingFraction = remainingMs / totalMs;
  if (remainingFraction > 0.5) return "green";
  if (remainingFraction > 0.1) return "amber";
  return "red";
}

const STYLE: Record<SlaLevel, string> = {
  green: "bg-k-green-bg text-k-ink",
  amber: "bg-k-amber-bg text-k-ink",
  red: "bg-k-red-bg text-k-ink",
  breached: "bg-k-red text-k-white",
};

export function SlaChip({ dueAt, totalHours }: SlaChipProps) {
  const t = useTranslations("components.slaChip");
  // Re-render once a minute so the remaining time stays current without a
  // per-second timer (RULE above). The very first render may briefly disagree
  // with the server-rendered markup by well under a minute; that is expected
  // for a live clock-like display and corrects itself on the first tick.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const level = slaState(dueAt, totalHours, now);
  const remainingMs = new Date(dueAt).getTime() - now.getTime();
  const label =
    level === "breached"
      ? t("breached")
      : remainingMs < 24 * 3_600_000
        ? t("hoursLeft", { count: Math.max(1, Math.ceil(remainingMs / 3_600_000)) })
        : t("daysLeft", { count: Math.round(remainingMs / (24 * 3_600_000)) });

  return <span className={`inline-flex items-center rounded-k-chip px-s-2 py-s-1 text-fs-14 ${STYLE[level]}`}>{label}</span>;
}
