// S07d — R12, R35
//
// RiskBandChip — the four NHS ERIC bands (build brief §7 glossary), each a
// background tint with its own icon and the band's own text — RagChip's own
// rule applies here too: never colour alone.
import { AlertOctagon, Info, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RiskBand } from "@ecapital/shared";

const STYLE: Record<RiskBand, { bg: string; icon: typeof AlertOctagon }> = {
  HIGH: { bg: "bg-k-red-bg", icon: AlertOctagon },
  SIGNIFICANT: { bg: "bg-k-amber-bg", icon: TriangleAlert },
  MODERATE: { bg: "bg-k-blue-bg", icon: Info },
  LOW: { bg: "bg-k-green-bg", icon: ShieldCheck },
};

export function RiskBandChip({ value }: { value: RiskBand }) {
  const t = useTranslations();
  const { bg, icon: Icon } = STYLE[value];
  return (
    <span className={`inline-flex items-center gap-s-1 whitespace-nowrap rounded-k-chip px-s-2 py-s-1 text-fs-14 text-k-ink ${bg}`}>
      <Icon aria-hidden="true" size={20} strokeWidth={1.5} />
      <span>{t(`riskBands.${value}`)}</span>
    </span>
  );
}
