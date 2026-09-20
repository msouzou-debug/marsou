"use client";

import { useTranslations } from "next-intl";
import type { AffectedArea, AreaTree } from "@ecapital/shared";

/**
 * AreaPicker — S11 step 2 "Χώροι που επηρεάζονται": an AssetBreadcrumb-style,
 * multi-select picker over the unit's own area tree (Κτίριο › Όροφος › Χώρος),
 * plus the indirect areas an already-picked system feeds beyond the ones
 * chosen here (UI instructions §5 S11, CAPEX-01 §6.1).
 *
 * | Prop            | Type            | Notes                                                                 |
 * |-----------------|-----------------|-------------------------------------------------------------------------|
 * | areaTree        | AreaTree        | The unit's own buildings/floors/areas (`GET /org-units/:id/areas`).      |
 * | selectedAreaIds | string[]        | Directly picked areas — this component is fully controlled.             |
 * | onToggle        | (areaId) => void| Fired when a direct area's control changes.                             |
 * | indirectAreas   | AffectedArea[]  | From `GET /areas/impact`, already filtered to `impact === "INDIRECT"`.  |
 * | loadingIndirect | boolean         | True while `/areas/impact` is in flight.                                |
 * | mode            | "multi" \| "single" | Defaults to "multi" (checkboxes, S11 step 2). "single" (radios, M4's asset form — one area per asset) keeps at most one id in `selectedAreaIds`; clicking the already-picked area is a no-op, same as any radio group. |
 *
 * RULE (§6.1, contract `AffectedArea.impact`): indirect areas are shown in
 * their own list, each labelled «Έμμεση επίπτωση μέσω <system>», and carry no
 * checkbox or remove control at all — only a directly picked area can be
 * un-picked. They still count for ICRA risk grouping and routing exactly
 * like direct ones (the caller passes them on unchanged); this component
 * only renders them as not removable.
 *
 * State: default, loading (the indirect list only — the tree itself is
 * static reference data the caller already has once the unit is known).
 */
export interface AreaPickerProps {
  areaTree: AreaTree;
  selectedAreaIds: string[];
  onToggle: (areaId: string) => void;
  indirectAreas?: AffectedArea[];
  loadingIndirect?: boolean;
  mode?: "multi" | "single";
}

export function AreaPicker({
  areaTree,
  selectedAreaIds,
  onToggle,
  indirectAreas = [],
  loadingIndirect = false,
  mode = "multi",
}: AreaPickerProps) {
  const t = useTranslations();
  const selected = new Set(selectedAreaIds);

  // RULE (§6.2): the ICRA risk group is the highest of all affected areas —
  // shown here so the requester already sees it while picking, not only in
  // the S12 wizard later.
  const riskOrder = ["LOW", "MEDIUM", "HIGH", "HIGHEST"] as const;
  const highest = indirectAreas.reduce<(typeof riskOrder)[number] | null>((max, area) => {
    if (!max) return area.patientRiskGroup;
    return riskOrder.indexOf(area.patientRiskGroup) > riskOrder.indexOf(max) ? area.patientRiskGroup : max;
  }, null);

  return (
    <div className="grid gap-s-5">
      <div className="max-h-[320px] overflow-auto rounded-k border border-k-grey">
        {areaTree.buildings.length === 0 ? (
          <p className="p-s-4 text-fs-14 text-k-text">{t("components.area-picker.empty")}</p>
        ) : (
          areaTree.buildings.map((building) => (
            <div key={building.id} className="border-b border-k-grey last:border-b-0">
              <p className="bg-k-surface px-s-3 py-s-2 text-fs-14 font-bold text-k-blue-deep">{building.nameEl}</p>
              {building.floors.map((floor) => (
                <div key={floor.id} className="px-s-3 py-s-2">
                  <p className="text-fs-12 text-k-text-muted">{floor.nameEl}</p>
                  <ul className="mt-s-1 flex flex-col gap-s-1">
                    {floor.areas.map((area) => (
                      <li key={area.id}>
                        <label className="flex min-h-[44px] items-center gap-s-3 text-fs-16 text-k-ink">
                          <input
                            type={mode === "single" ? "radio" : "checkbox"}
                            name={mode === "single" ? "area-picker-single" : undefined}
                            checked={selected.has(area.id)}
                            onChange={() => onToggle(area.id)}
                          />
                          {area.nameEl}
                          <span className="text-fs-12 text-k-text-muted">
                            {t(`areaType.${area.areaType}`)}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {(loadingIndirect || indirectAreas.length > 0) && (
        <div>
          <p className="text-fs-14 font-bold text-k-blue-deep">{t("components.area-picker.indirectTitle")}</p>
          {loadingIndirect ? (
            <div aria-busy="true" className="mt-s-2 grid gap-s-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-s-4 animate-pulse rounded-k-chip bg-k-grey" />
              ))}
            </div>
          ) : (
            <>
              <ul className="mt-s-2 flex flex-col gap-s-1">
                {indirectAreas.map((area) => (
                  <li
                    key={area.areaId}
                    className="flex items-center justify-between gap-s-3 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-ink"
                  >
                    <span>{area.nameEl}</span>
                    <span className="text-fs-12 text-k-text-muted">
                      {t("components.area-picker.viaSystem", {
                        system: area.viaSystem ? t(`permitSystem.${area.viaSystem}`) : "",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              {highest && (
                <p className="mt-s-2 text-fs-14 text-k-text">
                  {t("components.area-picker.highestRiskGroup", { group: t(`riskGroup.${highest}`) })}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
