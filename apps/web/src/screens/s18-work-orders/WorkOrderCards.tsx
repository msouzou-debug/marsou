"use client";

// S18 (list) — R33. Phone layout, the same reason `AssetCards` exists next to
// S16a's Table: a twelve-column row does not fit 390px. Each card is one
// link (≥44px tall) to S18a, with the ref, the title, the band, the status
// and the timers that matter on a phone.
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { WorkOrderListRow } from "@ecapital/shared";
import { formatDateTime, shortSystemName } from "@/lib/format";
import { BandChip } from "./BandChip";
import { EscalatedMark, rowTimers } from "./WorkOrderTimer";

export interface WorkOrderCardsProps {
  items: WorkOrderListRow[];
}

export function WorkOrderCards({ items }: WorkOrderCardsProps) {
  const t = useTranslations();

  return (
    <ul className="grid gap-s-3" aria-label={t("screens.s18.caption")}>
      {items.map((row) => {
        const timers = rowTimers(row);
        return (
          <li key={row.id}>
            <Link href={`/maintenance/${encodeURIComponent(row.id)}`} className="block min-h-[44px] rounded-k border border-k-grey bg-k-white p-s-4 shadow-k">
              <div className="flex flex-wrap items-center justify-between gap-s-2">
                <span className="font-k-mono text-fs-12 text-k-blue">{row.ref}</span>
                <span className="text-fs-14 text-k-text">{t(`workOrderStatus.${row.status}`)}</span>
              </div>
              <p className="mt-s-1 text-fs-16 text-k-ink">{row.titleEl}</p>
              <p className="mt-s-1 text-fs-14 text-k-text">
                {[row.assetName ?? shortSystemName(row.slaSystemName), row.areaName].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-s-2 flex flex-wrap items-center gap-s-2">
                <BandChip band={row.band} />
                {row.kind === "PM" ? timers.restore : (
                  <>
                    {timers.response}
                    {timers.restore}
                  </>
                )}
                {row.escalatedAt && <EscalatedMark />}
              </div>
              <p className="num mt-s-1 text-left text-fs-12 text-k-text">
                {t("screens.s18.columns.calledAt")}: {formatDateTime(row.calledAt)}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
