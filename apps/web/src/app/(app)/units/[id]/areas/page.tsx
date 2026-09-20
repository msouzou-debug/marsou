// S16 (lite) — R01, R02, R43
//
// The M0 proof (CAPEX-01 §14): a signed-in user sees their own unit's area
// tree and nothing else. Everything on this page is fetched on the server
// with the caller's own bearer, so the browser never receives a unit the
// caller may not see.

import type { OrgUnit } from "@ecapital/shared";
import { getLocale, getTranslations } from "next-intl/server";
import { AssetBreadcrumb } from "@/components/asset-breadcrumb";
import { NoPermission, PageTitle } from "@/components/app-shell";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { AreaTreeError } from "@/screens/s16-areas/AreaTreeError";
import { AreaTreeView } from "@/screens/s16-areas/AreaTreeView";
import { loadAreaTree, loadAssetCountsByArea } from "@/screens/s16-areas/load-tree";
import { OfflineNote } from "@/screens/s16-areas/OfflineNote";
import type { Locale } from "@/i18n/config";

function unitName(units: OrgUnit[], id: string, locale: Locale): string | undefined {
  const unit = units.find((u) => u.id === id);
  if (!unit) return undefined;
  return locale === "en" ? unit.nameEn : unit.nameEl;
}

export default async function UnitAreasPage({ params }: PageProps<"/units/[id]/areas">) {
  const { id } = await params;
  const [result, t, locale] = await Promise.all([loadAreaTree(id), getTranslations(), getLocale()]);

  if (result.kind === "noPermission") {
    return (
      <>
        {/* Who to ask is the head of estates of the unit, not the system
            administrator: org-unit access is granted by the unit that owns
            the estate (UI instructions §6). */}
        <NoPermission askRole={t("screens.s16.askRole")} />
        <HelpSection route="/units/[id]/areas" />
      </>
    );
  }

  const units = await getVisibleOrgUnits();
  const name = unitName(units, id, locale as Locale) ?? id;
  const building = result.kind === "tree" ? result.tree.buildings[0] : undefined;

  return (
    <>
      <PageTitle eyebrow={t("common.unit")} title={name} />
      {/* RULE: «Μονάδα › Κτίριο», never «Νοσοκομείο» as a level label
          (UI instructions §2). TODO(S17): the building segment gets its own
          page; until then both links stay on this screen. */}
      <AssetBreadcrumb
        segments={[
          { value: name, href: `/units/${encodeURIComponent(id)}/areas` },
          ...(building ? [{ value: building.nameEl, href: `/units/${encodeURIComponent(id)}/areas` }] : []),
        ]}
      />
      <div className="mt-s-6">
        <OfflineNote />
        {result.kind === "error" ? (
          <AreaTreeError />
        ) : result.tree.buildings.length === 0 ? (
          // Empty: one sentence, and no action — M0 has no way to add a
          // building or an area from the web app yet (UI instructions §6).
          <p className="max-w-[400px] text-fs-16 text-k-text">{t("screens.s16.empty")}</p>
        ) : (
          <AreaTreeView tree={result.tree} assetCounts={await loadAssetCountsByArea(id)} />
        )}
      </div>
      <HelpSection route="/units/[id]/areas" />
    </>
  );
}
