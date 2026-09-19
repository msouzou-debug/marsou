"use client";

// S03 — item 9 (M3, R19–R25)
//
// «Ανοικτές άδειες» card: this project's own open shutdown permits, each
// linking through to the permit detail (item 9 of the M3 task). Same
// Screen/pure split as `ContractsCard` right above it: `ProjectOverviewScreen`
// fetches with `useProjectPermits` and hands the rows down as a prop.
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PermitListRow } from "@ecapital/shared";
import { IcraBadge } from "@/components/icra-badge";
import { formatDate } from "@/lib/format";

export interface OpenPermitsCardProps {
  permits?: PermitListRow[];
  loading?: boolean;
  error?: boolean;
}

export function OpenPermitsCard({ permits, loading = false, error = false }: OpenPermitsCardProps) {
  const t = useTranslations();

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s03.openPermitsTitle")}</h2>

      {loading ? (
        <ul aria-hidden="true" className="mt-s-3 grid gap-s-2">
          {[0, 1].map((i) => (
            <li key={i} className="h-s-4 animate-pulse rounded-k-chip bg-k-grey" />
          ))}
        </ul>
      ) : error ? (
        <p className="mt-s-2 text-fs-14 text-k-text">{t("states.error.loadFailed")}</p>
      ) : !permits || permits.length === 0 ? (
        <p className="mt-s-2 text-fs-14 text-k-text">{t("screens.s03.openPermitsEmpty")}</p>
      ) : (
        <ul className="mt-s-3 grid gap-s-2">
          {permits.map((permit) => (
            <li key={permit.id} className="flex items-center justify-between gap-s-3 border-t border-k-grey pt-s-2 first:border-t-0 first:pt-0">
              <div>
                <Link
                  href={`/permits/${encodeURIComponent(permit.id)}`}
                  className="block text-fs-14 font-bold text-k-blue-deep underline-offset-2 hover:underline"
                >
                  {permit.titleEl}
                </Link>
                <p className="text-fs-12 text-k-text">
                  {formatDate(permit.plannedStart)} – {formatDate(permit.plannedEnd)} · {t(`permitStatus.${permit.status}`)}
                </p>
              </div>
              {permit.icraClass && <IcraBadge icraClass={permit.icraClass} size="list" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
