"use client";

// S16a (list) — R26–R30, R45. Phone layout, same reason `PermitCards` exists
// next to S11's own `Table`: a row-per-line grid does not fit 390px.
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AssetListRow } from "@ecapital/shared";
import { ConditionChip } from "@/components/condition-chip";
import { CriticalityChip } from "@/components/criticality-chip";
import { formatDate } from "@/lib/format";

export interface AssetCardsProps {
  items: AssetListRow[];
}

export function AssetCards({ items }: AssetCardsProps) {
  const t = useTranslations();

  return (
    <ul className="grid gap-s-3">
      {items.map((asset) => (
        <li key={asset.id}>
          <Link
            href={`/assets/${encodeURIComponent(asset.id)}`}
            className="block rounded-k border border-k-grey bg-k-white p-s-4 shadow-k"
          >
            <p className="font-k-mono text-fs-12 text-k-blue">{asset.tag}</p>
            <p className="mt-s-1 text-fs-16 text-k-ink">{asset.nameEl}</p>
            <p className="mt-s-1 text-fs-14 text-k-text">
              {asset.orgUnitNameEl}
              {asset.areaNameEl ? ` · ${asset.areaNameEl}` : ""}
            </p>
            <div className="mt-s-2 flex flex-wrap items-center gap-s-3">
              <CriticalityChip value={asset.criticality as 1 | 2 | 3 | 4 | 5} />
              <ConditionChip value={asset.condition} />
              <span className="text-fs-14 text-k-text">{t(`assetStatus.${asset.status}`)}</span>
            </div>
            {asset.warrantyEnd && (
              <p className="num mt-s-1 text-fs-12 text-k-text">
                {t("screens.s16a.columns.warrantyEnd")}: {formatDate(asset.warrantyEnd)}
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
