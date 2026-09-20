// S16 (lite) — R01, R02

/**
 * AreaTreeView — the building → floor → area tree of one org unit
 * (CAPEX-01 §4; UI instructions §5 S16). Pure: it takes a tree and renders
 * it, so the page owns loading, error, no-permission and offline.
 *
 * | Prop     | Type     | Notes                                            |
 * |----------|----------|---------------------------------------------------|
 * | tree     | AreaTree | What `GET /org-units/:id/areas` answered           |
 *
 * RULE (CAPEX-01 §12): nothing here describes a person. `beds` counts the
 * beds a room holds and `patientRiskGroup` is the ICRA 2.0 band of the room
 * itself — both are properties of the building, not of anybody in it.
 *
 * RULE: the risk group is plain text, not a coloured chip. It is ICRA data,
 * and the ICRA class is a matrix of activity type × risk group that this
 * screen does not know; colouring the band alone would read as a verdict the
 * system has not reached yet. IcraBadge takes over in M3.
 *
 * `assetCounts` (M4 build brief item 7): a count of assets per area id, and
 * a «Προβολή παγίων» link to the register filtered to it (`/assets?unit=&areaId=`).
 * Optional and additive — an S16 page that cannot reach M4's own API (or one
 * predating it) omits the prop and the tree renders exactly as before.
 */

import { Building2, DoorOpen, Layers } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AreaTree } from "@ecapital/shared";

export interface AreaTreeViewProps {
  tree: AreaTree;
  assetCounts?: Record<string, number>;
}

export function AreaTreeView({ tree, assetCounts = {} }: AreaTreeViewProps) {
  const t = useTranslations("screens.s16");
  // The level label is the breadcrumb's, so «Κτίριο» is written once
  // (UI instructions §2: level names are fixed, never re-invented per screen).
  const level = useTranslations("components.asset-breadcrumb.levels");

  return (
    <ul data-testid="area-tree" className="flex flex-col gap-s-6">
      {tree.buildings.map((building) => (
        <li key={building.id} className="rounded-k border border-k-grey bg-k-white p-s-4">
          <div className="flex items-start gap-s-2">
            <Building2 size={20} strokeWidth={1.5} aria-hidden="true" className="mt-s-1 shrink-0 text-k-blue-deep" />
            <div className="min-w-0">
              <p className="eyebrow">{level("building")}</p>
              <h2 className="text-fs-20 text-k-blue-deep">{building.nameEl}</h2>
              <p className="text-fs-14 text-k-text">
                <span className="num">{building.code}</span>
                {building.storeys === null ? null : <> · {t("storeys", { count: building.storeys })}</>}
                {building.yearBuilt === null ? null : <> · {t("yearBuilt", { year: String(building.yearBuilt) })}</>}
              </p>
            </div>
          </div>

          <ul className="mt-s-4 flex flex-col gap-s-4 border-l border-k-grey pl-s-4">
            {building.floors.map((floor) => (
              <li key={floor.id}>
                <div className="flex items-center gap-s-2">
                  <Layers size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-k-text" />
                  <h3 className="text-fs-16 text-k-text">{floor.nameEl}</h3>
                  <span className="num text-fs-14 text-k-text-muted">{floor.code}</span>
                </div>

                <ul className="mt-s-2 flex flex-col gap-s-2 border-l border-k-grey pl-s-4">
                  {floor.areas.map((area) => (
                    <li key={area.id} className="flex items-start gap-s-2">
                      <DoorOpen size={20} strokeWidth={1.5} aria-hidden="true" className="mt-s-1 shrink-0 text-k-text" />
                      <div className="min-w-0">
                        <p className="text-fs-16 text-k-text">
                          {area.nameEl} <span className="num text-fs-14 text-k-text-muted">{area.code}</span>
                        </p>
                        <p className="text-fs-14 text-k-text">
                          {t(`areaType.${area.areaType}`)}
                          {" · "}
                          {t("riskGroupValue", { group: t(`riskGroup.${area.patientRiskGroup}`) })}
                          {area.beds === null ? null : <> · {t("beds", { count: area.beds })}</>}
                        </p>
                        <p className="mt-s-1 flex items-center gap-s-2 text-fs-14 text-k-text">
                          <span>{t("assetCount", { count: assetCounts[area.id] ?? 0 })}</span>
                          <Link
                            href={`/assets?unit=${encodeURIComponent(tree.orgUnitId)}&areaId=${encodeURIComponent(area.id)}`}
                            className="text-k-blue hover:underline"
                          >
                            {t("viewAssets")}
                          </Link>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
