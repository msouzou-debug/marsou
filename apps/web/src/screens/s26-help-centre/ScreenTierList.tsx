// S26 (owner decision 20/09/2026 — docs/briefs/README.md Errata "Screen
// tiers") — every screen in help/map.json, grouped by tier with the persona
// list, shown above the guide downloads (UI instructions §5 S26 groups the
// help centre's own content above the per-persona PDF table).
//
// Pure and presentational: it takes the already-grouped, already-localized
// rows from `listScreensByTier` (help/list-screens-by-tier.ts), the same
// split style GuideIndexTable takes `index.json`'s rows — the page owns
// reading the data, this owns rendering it.
import { useTranslations } from "next-intl";
import { TierChip } from "@/components/tier-chip";
import type { TierScreen } from "@/help/list-screens-by-tier";

export interface ScreenTierListProps {
  dayOne: TierScreen[];
  optional: TierScreen[];
}

function ScreenGroup({ screens }: { screens: TierScreen[] }) {
  const roles = useTranslations("roles");

  return (
    <ul className="divide-y divide-k-grey">
      {screens.map((screen) => (
        <li key={screen.id} className="flex flex-wrap items-baseline gap-x-s-2 py-s-2 text-fs-14">
          <span className="num text-k-text-muted">{screen.id}</span>
          <span className="font-bold text-k-ink">{screen.title}</span>
          <span className="text-k-text">{screen.persona.map((p) => roles(p)).join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}

export function ScreenTierList({ dayOne, optional }: ScreenTierListProps) {
  const t = useTranslations("screens.s26.screenList");

  return (
    <div>
      <h3 className="mb-s-3 text-fs-20">{t("heading")}</h3>

      {dayOne.length > 0 && (
        <section className="mb-s-6">
          <div className="mb-s-2 flex items-center gap-s-2">
            <TierChip tier="day-one" />
            <h4 className="text-fs-16 font-bold text-k-ink">{t("dayOneHeading")}</h4>
          </div>
          <ScreenGroup screens={dayOne} />
        </section>
      )}

      {optional.length > 0 && (
        <section>
          <div className="mb-s-2 flex items-center gap-s-2">
            <TierChip tier="optional" />
            <h4 className="text-fs-16 font-bold text-k-ink">{t("optionalHeading")}</h4>
          </div>
          <ScreenGroup screens={optional} />
        </section>
      )}
    </div>
  );
}
