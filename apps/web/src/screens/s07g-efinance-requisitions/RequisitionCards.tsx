"use client";

// S07g — ADR-0029 (phone layout)
//
// One card per requisition under 1024px: number, status, description, amount,
// order number and created date. Same `tablet:hidden` / `hidden tablet:block`
// split as S08 and S07f.
import { useTranslations } from "next-intl";
import type { EFinanceRequisition } from "@ecapital/shared";
import { formatDate, formatEURorDash } from "@/lib/format";

export interface RequisitionCardsProps {
  requisitions: EFinanceRequisition[];
}

export function RequisitionCards({ requisitions }: RequisitionCardsProps) {
  const t = useTranslations("screens.s07g");
  return (
    <ul className="grid gap-s-3">
      {requisitions.map((requisition) => (
        <li key={requisition.id} className="rounded-k border border-k-grey bg-k-white p-s-4 shadow-k">
          <div className="flex items-start justify-between gap-s-2">
            <span className="num text-fs-14 text-k-ink">{requisition.number}</span>
            <span className="inline-flex h-6 items-center rounded-k-chip bg-k-grey px-s-2 text-fs-14 text-k-ink">{requisition.status}</span>
          </div>
          <p className="mt-s-1 text-fs-16 text-k-ink">{requisition.description ?? "—"}</p>
          <p className="num mt-s-2 text-fs-16 text-k-ink">{formatEURorDash(requisition.amount)}</p>
          <dl className="mt-s-2 grid grid-cols-2 gap-s-2 text-fs-14">
            <div>
              <dt className="text-fs-12 text-k-text">{t("columns.poNumber")}</dt>
              <dd className="num text-k-ink">{requisition.poNumber ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-fs-12 text-k-text">{t("columns.createdAt")}</dt>
              <dd className="num text-k-ink">{formatDate(requisition.createdAt)}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
