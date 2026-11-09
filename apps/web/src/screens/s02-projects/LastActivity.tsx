"use client";

// S02 — ADR-0035
//
// «Ενημέρωση»: the date of the newest change on a project or anything under
// it. At STALE_AFTER_DAYS or more it is red and its title says for how many
// days nobody has touched the project (the number is in the title as well as
// the colour, so the colour is never the only signal).
import { useTranslations } from "next-intl";
import { STALE_AFTER_DAYS } from "@ecapital/shared";
import { formatDate } from "@/lib/format";

const DAY_MS = 86_400_000;

export function daysSince(iso: string, today: Date): number {
  return Math.max(0, Math.floor((today.getTime() - new Date(iso).getTime()) / DAY_MS));
}

export function LastActivity({ iso, today }: { iso: string | null; today?: Date }) {
  const t = useTranslations();
  if (!iso) return <>{t("common.notAvailable")}</>;
  const days = daysSince(iso, today ?? new Date());
  const stale = days >= STALE_AFTER_DAYS;
  return (
    <span className={stale ? "text-k-red" : undefined} title={stale ? t("screens.s02.staleTitle", { days }) : undefined}>
      {formatDate(iso)}
    </span>
  );
}
