import { useTranslations } from "next-intl";
import type { IcraActivityType, IcraClass, IcraMatrixCell, PatientRiskGroup } from "@ecapital/shared";

const ACTIVITY_TYPES: IcraActivityType[] = ["A", "B", "C", "D"];
const RISK_GROUPS: PatientRiskGroup[] = ["LOW", "MEDIUM", "HIGH", "HIGHEST"];

/**
 * IcraMatrixGrid — the 4×4 ASHE ICRA matrix excerpt shown beneath the
 * IcraBadge on S12 step 3, with the producing cell highlighted so the
 * requester can see why they got that class (UI instructions §4 IcraBadge,
 * §5 S12: "the matrix cell must always be visible with the class").
 *
 * | Prop         | Type                | Notes                                                  |
 * |--------------|---------------------|-----------------------------------------------------------|
 * | cells        | IcraMatrixCell[]    | The active matrix version's 16 cells.                        |
 * | activityType | IcraActivityType    | The producing row.                                          |
 * | riskGroup    | PatientRiskGroup    | The producing column.                                       |
 *
 * State: default only — reference data the caller already has.
 */
export interface IcraMatrixGridProps {
  cells: IcraMatrixCell[];
  activityType: IcraActivityType;
  riskGroup: PatientRiskGroup;
}

export function IcraMatrixGrid({ cells, activityType, riskGroup }: IcraMatrixGridProps) {
  const t = useTranslations();
  const cellByKey = new Map(cells.map((c) => [`${c.activityType}-${c.riskGroup}`, c]));

  function classOf(a: IcraActivityType, r: PatientRiskGroup): IcraClass | undefined {
    return cellByKey.get(`${a}-${r}`)?.icraClass;
  }

  return (
    <table className="border-collapse text-fs-12">
      <caption className="sr-only">{t("components.icra-matrix-grid.caption")}</caption>
      <thead>
        <tr>
          <th scope="col" className="p-s-1" />
          {RISK_GROUPS.map((group) => (
            <th key={group} scope="col" className="p-s-1 font-bold text-k-blue-deep">
              {t(`riskGroupShort.${group}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ACTIVITY_TYPES.map((type) => (
          <tr key={type}>
            <th scope="row" className="p-s-1 text-left font-bold text-k-blue-deep">
              {type}
            </th>
            {RISK_GROUPS.map((group) => {
              const isProducingCell = type === activityType && group === riskGroup;
              const value = classOf(type, group);
              return (
                <td key={group} className="p-s-1">
                  <span
                    // RULE (CONVENTIONS.md / UI instructions §1): purple is
                    // reserved for IcraBadge and PermitBanner alone, so the
                    // producing cell is highlighted with a heavy ink border
                    // and bold text instead of a purple fill — never a third
                    // place `--k-purple` appears.
                    aria-current={isProducingCell ? "true" : undefined}
                    className={`flex h-6 w-6 items-center justify-center rounded-k-chip ${
                      isProducingCell
                        ? "border-2 border-k-ink bg-k-white font-bold text-k-ink"
                        : "bg-k-surface text-k-text"
                    }`}
                  >
                    {value ?? "–"}
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
