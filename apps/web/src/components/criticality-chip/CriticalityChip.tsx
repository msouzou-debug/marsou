import { useTranslations } from "next-intl";

/**
 * CriticalityChip — the 1–5 criticality band on the asset register (S16a) and
 * detail (S17), per the M4 build brief item 1 and `packages/shared/src/asset.ts`'s
 * own `Criticality` RULE.
 *
 * | Prop  | Type              | Notes                                  |
 * |-------|-------------------|------------------------------------------|
 * | value | 1 \| 2 \| 3 \| 4 \| 5 | 1 = life-critical, 5 = cosmetic.       |
 *
 * RULE (contract `asset.ts` Criticality comment): 1–2 is the urgent band
 * (red), 3 is the watch band (amber tint, `--k-ink` text — amber fails
 * contrast for text per UI instructions §7), 4–5 is routine (grey). Never
 * purple — CONVENTIONS.md reserves `--k-purple` for IcraBadge/PermitBanner
 * alone.
 *
 * State: default only — the band is a computed value the parent already has,
 * the same as RagChip/IcraBadge.
 */
export type CriticalityValue = 1 | 2 | 3 | 4 | 5;

export interface CriticalityChipProps {
  value: CriticalityValue;
}

const BG: Record<CriticalityValue, string> = {
  1: "bg-k-red-bg",
  2: "bg-k-red-bg",
  3: "bg-k-amber-bg",
  4: "bg-k-grey",
  5: "bg-k-grey",
};

export function CriticalityChip({ value }: CriticalityChipProps) {
  const t = useTranslations("components.criticality-chip");
  return (
    <span
      className={`num inline-flex h-6 min-w-6 items-center justify-center rounded-k-chip px-s-2 text-fs-14 text-k-ink ${BG[value]}`}
      aria-label={t("label", { value })}
    >
      {value}
    </span>
  );
}
