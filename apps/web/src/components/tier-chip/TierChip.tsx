import { useTranslations } from "next-intl";
import type { Tier } from "@/help/tier";

/**
 * TierChip — owner decision, 20/09/2026 (docs/briefs/README.md Errata
 * "Screen tiers"): every screen is either trained and used from day one, or
 * held back as optional for phase two. This chip is the one place that
 * decision renders as UI — next to a screen's title in the S25 help drawer
 * (`HelpSection.tsx`) and in the S26 help centre's screen list
 * (`ScreenTierList.tsx`), both reading it from `help/map.json`.
 *
 * | Prop | Type   | Notes                                    |
 * |------|--------|-------------------------------------------|
 * | tier | Tier   | "day-one" \| "optional", from help/map.json |
 *
 * State: default only — a TierChip reflects a value its parent already has
 * (the map entry), so there is no loading, empty, no-permission or offline
 * state of its own.
 *
 * RULE (CONVENTIONS.md): outline only, never a filled chip — this is a
 * training-plan marker, not a status colour like RagChip or SlaChip, so it
 * stays visually quieter than those. Brand blue outline for day-one, grey
 * outline for optional; the label text carries the meaning either way, not
 * the colour alone.
 */
export interface TierChipProps {
  tier: Tier;
}

const STYLE: Record<Tier, string> = {
  "day-one": "border-k-blue text-k-blue-deep",
  optional: "border-k-grey text-k-text",
};

export function TierChip({ tier }: TierChipProps) {
  const t = useTranslations("components.tierChip");
  const label = tier === "day-one" ? t("dayOne") : t("optional");

  return (
    <span
      className={`inline-flex items-center rounded-k-chip border px-s-2 py-s-1 text-fs-14 whitespace-nowrap ${STYLE[tier]}`}
    >
      {label}
    </span>
  );
}
