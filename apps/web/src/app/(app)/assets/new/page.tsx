// S17a — R26–R30, R45

import { cookies } from "next/headers";
import { UNIT_COOKIE } from "@/auth/cookies";
import { canWriteAssets } from "@/auth/roles";
import { getSession } from "@/auth/session";
import { getVisibleOrgUnits } from "@/data/server";
import { HelpSection } from "@/help/HelpSection";
import { AssetFormScreen } from "@/screens/s17a-asset-form/AssetFormScreen";

// Same posture `projects/new/page.tsx` documents: a role that cannot write
// assets never sees a live «Προσθήκη» link (S16a hides it), but opening the
// URL directly still renders the form — read-only here (build brief item 2)
// rather than a submit that would only ever come back 403.
export default async function NewAssetPage() {
  const [session, orgUnits, unitCookie] = await Promise.all([getSession(), getVisibleOrgUnits(), cookies()]);
  const defaultOrgUnitId = unitCookie.get(UNIT_COOKIE)?.value;
  const roles = session?.me.roles ?? [];
  return (
    <>
      <AssetFormScreen mode="create" orgUnits={orgUnits} defaultOrgUnitId={defaultOrgUnitId} readOnly={!canWriteAssets(roles)} />
      <HelpSection route="/assets/new" />
    </>
  );
}
