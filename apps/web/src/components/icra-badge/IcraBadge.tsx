import { useTranslations } from "next-intl";

/**
 * IcraBadge — eCapital UI instructions §4. One of only two components allowed
 * to use `--k-purple` (ADR-0006); the other is PermitBanner.
 *
 * | Prop          | Type                                  | Notes                                            |
 * |---------------|----------------------------------------|---------------------------------------------------|
 * | icraClass     | "I" \| "II" \| "III" \| "IV" \| "V"    | Latin numeral, per CAPEX-02 §7.                    |
 * | size          | "list" \| "wizard" \| "print"          | 24 / 48 / 64px tall.                               |
 * | onPurple      | boolean?                               | White-on-purple variant, for use inside PermitBanner. |
 * | activityType  | string (wizard only)                   | e.g. "B" — S12 step 1.                             |
 * | riskGroup     | string (wizard only)                   | e.g. "3" — S12 step 2.                             |
 * | matrixVersion | string (wizard only)                   | Active ICRA matrix version id.                     |
 *
 * State: default only — the class is a computed value the parent already has.
 *
 * RULE: an unhandled ICRA class is out of scope here. `icraClass` is typed to
 * the fixed I–V set, and no fallback rendering for a value outside it is
 * implemented — that is a data problem the briefs do not describe how to show
 * safely, and this is flagged in the hand-back summary rather than guessed at.
 */

export type IcraClass = "I" | "II" | "III" | "IV" | "V";
export type IcraBadgeSize = "list" | "wizard" | "print";

interface IcraBadgeBaseProps {
  icraClass: IcraClass;
  onPurple?: boolean;
}
interface IcraBadgeListPrintProps extends IcraBadgeBaseProps {
  size: "list" | "print";
}
interface IcraBadgeWizardProps extends IcraBadgeBaseProps {
  size: "wizard";
  // RULE (UI instructions §4): in wizard size the matrix cell is always visible
  // alongside the class, so these are required, not optional, in this variant.
  activityType: string;
  riskGroup: string;
  matrixVersion: string;
}
export type IcraBadgeProps = IcraBadgeListPrintProps | IcraBadgeWizardProps;

const SIZE_CLASSES: Record<IcraBadgeSize, string> = {
  list: "h-6 px-s-2 text-fs-14",
  wizard: "h-12 px-s-4 text-fs-24",
  print: "h-16 px-s-4 text-fs-32",
};

// Tint per class (CAPEX-02 §4 / UI instructions §4): I & II purple tint on
// purple text, III purple outline on white, IV & V purple fill on white text.
function tintClasses(icraClass: IcraClass, onPurple: boolean): string {
  if (onPurple) {
    // Already on a purple field (PermitBanner) — a white outline on the
    // existing purple ground reads clearly without a second tint underneath.
    return "border border-k-white text-k-white bg-transparent";
  }
  if (icraClass === "I" || icraClass === "II") return "bg-k-purple-bg text-k-purple";
  if (icraClass === "III") return "bg-k-white text-k-purple border border-k-purple";
  return "bg-k-purple text-k-white"; // IV, V
}

export function IcraBadge(props: IcraBadgeProps) {
  const t = useTranslations("components.icraBadge");
  const { icraClass, size, onPurple = false } = props;

  return (
    <div className="inline-flex flex-col items-start gap-s-1">
      <span
        className={`inline-flex items-center justify-center rounded-k font-bold leading-none ${SIZE_CLASSES[size]} ${tintClasses(icraClass, onPurple)}`}
      >
        {icraClass}
      </span>
      {props.size === "wizard" && (
        <div>
          <p className="text-fs-14 text-k-ink">
            {t("matrix", { activityType: props.activityType, riskGroup: props.riskGroup, icraClass })}
          </p>
          <p className="text-fs-12 text-k-text">{t("matrixVersion", { version: props.matrixVersion })}</p>
        </div>
      )}
    </div>
  );
}
