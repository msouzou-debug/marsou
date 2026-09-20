// S16 (lite) — R01
//
// One server-side fetch, three outcomes. Kept apart from `page.tsx` so the
// access rule below can be tested on its own: an async Server Component
// cannot be rendered by the test renderer, and this is the part that matters.

import { AreaTree, AssetListRow } from "@ecapital/shared";
import { z } from "zod";
import { ApiError } from "@/data/client";
import { serverApi } from "@/data/server";

export type AreaTreeResult =
  | { kind: "tree"; tree: AreaTree }
  | { kind: "noPermission" }
  | { kind: "error" };

export async function loadAreaTree(orgUnitId: string): Promise<AreaTreeResult> {
  const api = await serverApi();
  if (!api) return { kind: "noPermission" };
  try {
    const tree = await api.get(`/org-units/${encodeURIComponent(orgUnitId)}/areas`, AreaTree);
    return { kind: "tree", tree };
  } catch (error) {
    // RULE (ADR-0010): 404 *is* the access answer. The API returns it both for
    // a unit that does not exist and for a unit outside the caller's access,
    // on purpose — a 403 would confirm the unit exists, which is the one fact
    // somebody outside it must not be able to learn. So this screen must not
    // try to tell the two apart either: one state, one wording, both cases.
    if (error instanceof ApiError && error.status === 404) return { kind: "noPermission" };
    return { kind: "error" };
  }
}

// M4 build brief item 7: each area row gains a count of assets. A failure
// here (M4's own API not reachable, or simply no assets yet) never fails the
// S16 page itself — it is additive to a screen that already works without
// it — so this returns an empty map rather than an error kind.
export async function loadAssetCountsByArea(orgUnitId: string): Promise<Record<string, number>> {
  const api = await serverApi();
  if (!api) return {};
  try {
    // RULE (contract `AssetListQuery.pageSize`, apps/api ListQuery): the API
    // caps pageSize at 100 and 400s a larger one, which this function would
    // otherwise have silently swallowed into an empty count map (the `catch`
    // below, per this function's own note above).
    const page = await api.get(
      `/assets?orgUnitId=${encodeURIComponent(orgUnitId)}&pageSize=100`,
      z.object({ items: z.array(AssetListRow), total: z.number().int() }),
    );
    const counts: Record<string, number> = {};
    for (const asset of page.items) {
      if (!asset.areaId) continue;
      counts[asset.areaId] = (counts[asset.areaId] ?? 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}
