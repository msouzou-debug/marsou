import { useTranslations } from "next-intl";
import type { Condition } from "@ecapital/shared";

/**
 * ConditionChip — the A–E «Φυσική κατάσταση» band (M4 build brief item 1,
 * `packages/shared/src/asset.ts`'s own `Condition` RULE: A = as new, E = life
 * expired). Used on the register (S16a) and the detail page (S17).
 *
 * | Prop  | Type                | Notes                        |
 * |-------|---------------------|----------------------------------|
 * | value | Condition \| null   | `null` renders «—», never a chip. |
 *
 * RULE (CAPEX-02 §7 glossary): this is «Φυσική κατάσταση», never the plain
 * «Κατάσταση» reserved for lifecycle status — the label lives on the caller
 * (column header / field label), not on the chip itself, so the chip stays
 * reusable in either place.
 *
 * State: default only — a computed value the parent already has.
 */
export interface ConditionChipProps {
  value: Condition | null;
}

const BG: Record<Condition, string> = {
  A: "bg-k-green-bg",
  B: "bg-k-green-bg",
  C: "bg-k-amber-bg",
  D: "bg-k-red-bg",
  E: "bg-k-red-bg",
};

export function ConditionChip({ value }: ConditionChipProps) {
  const t = useTranslations("components.condition-chip");
  if (value === null) {
    return <span className="num text-k-text">{t("notAssessed")}</span>;
  }
  return (
    <span
      className={`num inline-flex h-6 min-w-6 items-center justify-center rounded-k-chip px-s-2 text-fs-14 text-k-ink ${BG[value]}`}
      aria-label={t(`letters.${value}`)}
    >
      {value}
    </span>
  );
}
