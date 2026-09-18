import { Check, TriangleAlert, X } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * RagChip — eCapital UI instructions §4.
 *
 * | Prop      | Type                          | Notes                                                  |
 * |-----------|-------------------------------|---------------------------------------------------------|
 * | value     | "green" \| "amber" \| "red"   | Which RAG state this chip reports.                       |
 * | variant   | "label" \| "count"            | Defaults to "label". "count" is the compact S01 form.    |
 * | count     | number                        | Required when `variant` is "count".                      |
 *
 * State: default only. RagChip reflects a value its parent already computed —
 * there is nothing for it to load, be empty, lack permission for, or go
 * offline over.
 */

export type RagValue = "green" | "amber" | "red";

interface RagChipLabelProps {
  value: RagValue;
  variant?: "label";
  count?: never;
}
interface RagChipCountProps {
  value: RagValue;
  variant: "count";
  count: number;
}
export type RagChipProps = RagChipLabelProps | RagChipCountProps;

const ICONS = { green: Check, amber: TriangleAlert, red: X } as const;
const BG = { green: "bg-k-green-bg", amber: "bg-k-amber-bg", red: "bg-k-red-bg" } as const;
const ICON_COLOR = { green: "text-k-green", amber: "text-k-amber", red: "text-k-red" } as const;

export function RagChip(props: RagChipProps) {
  const t = useTranslations("components.ragChip");
  const { value } = props;
  const Icon = ICONS[value];
  const label = t(value);

  return (
    <span
      className={`inline-flex items-center gap-s-1 whitespace-nowrap rounded-k-chip py-s-1 text-fs-14 text-k-ink ${props.variant === "count" ? "px-s-1" : "px-s-2"} ${BG[value]}`}
    >
      {/* RULE (UI instructions §4): RAG is never colour alone — the icon shape already
          differs per status (check / triangle / x) so the chip survives greyscale
          print, and a text label is always rendered: the full label in the "label"
          variant, an aria-label carrying the same word in the compact "count" variant
          used for S01's dense unit table. */}
      <Icon aria-hidden="true" size={20} strokeWidth={1.5} className={ICON_COLOR[value]} />
      {props.variant === "count" ? (
        <span aria-label={label} className="num">
          {props.count}
        </span>
      ) : (
        <span>{label}</span>
      )}
    </span>
  );
}
