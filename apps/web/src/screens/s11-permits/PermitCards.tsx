"use client";

// S11 (list) — R19–R25. Phone layout, same reason `ProjectCards` exists next
// to S02's own `Table`: a row-per-line grid does not fit 390px.
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PermitListRow } from "@ecapital/shared";
import { IcraBadge } from "@/components/icra-badge";
import { formatDate } from "@/lib/format";

export interface PermitCardsProps {
  items: PermitListRow[];
  unitNameById: Map<string, string>;
}

export function PermitCards({ items, unitNameById }: PermitCardsProps) {
  const t = useTranslations();

  return (
    <ul className="grid gap-s-3">
      {items.map((permit) => (
        <li key={permit.id}>
          <Link
            href={`/permits/${encodeURIComponent(permit.id)}`}
            className="block rounded-k border border-k-grey bg-k-white p-s-4 shadow-k"
          >
            <p className="num text-fs-12 text-k-text-muted">{permit.ref ?? t("screens.s11.noRefYet")}</p>
            <p className="mt-s-1 text-fs-16 text-k-ink">{permit.titleEl}</p>
            <p className="mt-s-1 text-fs-14 text-k-text">{unitNameById.get(permit.orgUnitId) ?? permit.orgUnitNameEl}</p>
            <p className="num mt-s-1 text-fs-14 text-k-text">
              {formatDate(permit.plannedStart)} – {formatDate(permit.plannedEnd)}
            </p>
            <div className="mt-s-2 flex items-center justify-between gap-s-2">
              <span className="text-fs-14 text-k-text">{t(`permitStatus.${permit.status}`)}</span>
              {permit.icraClass && <IcraBadge icraClass={permit.icraClass} size="list" />}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
