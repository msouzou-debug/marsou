// S16 (lite) — R01
//
// One server-side fetch, three outcomes. Kept apart from `page.tsx` so the
// access rule below can be tested on its own: an async Server Component
// cannot be rendered by the test renderer, and this is the part that matters.

import { AreaTree } from "@ecapital/shared";
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
