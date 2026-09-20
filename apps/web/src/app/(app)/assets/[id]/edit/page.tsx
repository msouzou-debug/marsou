// S17a — R26–R30, R45

import { AssetDetail } from "@ecapital/shared";
import { canWriteAssets } from "@/auth/roles";
import { getSession } from "@/auth/session";
import { NoPermission } from "@/components/app-shell";
import { serverApi } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { AssetFormScreen } from "@/screens/s17a-asset-form/AssetFormScreen";
import type { AssetFormValues } from "@/screens/s17a-asset-form/schema";

function toFormValues(asset: AssetDetail): AssetFormValues {
  return {
    nameEl: asset.nameEl,
    assetClass: asset.assetClass,
    areaId: asset.areaId,
    parentAssetId: asset.parentAssetId,
    manufacturer: asset.manufacturer,
    model: asset.model,
    serialNo: asset.serialNo,
    installedDate: asset.installedDate,
    commissionedDate: asset.commissionedDate,
    sourceProjectId: asset.sourceProjectId,
    sourceContractId: asset.sourceContractId,
    capitalCost: asset.capitalCost,
    warrantyEnd: asset.warrantyEnd,
    expectedLifeYears: asset.expectedLifeYears,
    replacementYear: asset.replacementYear,
    replacementCostEst: asset.replacementCostEst,
    criticality: asset.criticality,
    system: asset.system,
    servesAreaIds: asset.servesAreaIds,
  };
}

// Server Component, same pattern `projects/[id]/edit/page.tsx` documents:
// fetched server-side so the form opens already filled in; the API's 404
// covers "no such asset" and "not yours" alike (ADR-0010's precedent), one
// `NoPermission` either way.
export default async function EditAssetPage({ params }: PageProps<"/assets/[id]/edit">) {
  const { id } = await params;
  const [api, session] = await Promise.all([serverApi(), getSession()]);
  const asset = api ? await api.get(`/assets/${encodeURIComponent(id)}`, AssetDetail).catch(() => null) : null;

  if (!asset) return <NoPermission />;

  return (
    <>
      <AssetFormScreen
        mode="edit"
        orgUnits={[]}
        assetId={asset.id}
        editOrgUnitId={asset.orgUnitId}
        initialValues={toFormValues(asset)}
        initialParentTag={asset.parentTag ?? undefined}
        initialSourceProjectLabel={asset.sourceProjectCode ?? undefined}
        initialSourceContractLabel={asset.sourceContractRef ?? undefined}
        readOnly={!canWriteAssets(session?.me.roles ?? [])}
      />
      <HelpSection route="/assets/[id]/edit" />
    </>
  );
}
