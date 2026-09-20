// Scan route — R29 (M4 build brief item 5)
//
// The `/a/[tag]` page's own access/lookup rule, kept apart from `page.tsx`
// the same way `s16-areas/load-tree.ts` keeps `loadAreaTree` apart from its
// page: an async Server Component cannot be rendered by the test renderer,
// and this is the part that matters — whether a signed-out visit sends the
// technician through the sign-in gate with `next=` set to come straight
// back here, and whether a resolved tag lands on the asset or on the §6
// not-found message.
import { Asset } from "@ecapital/shared";
import type { ServerApi } from "@/data/server";

export type ScanResult =
  | { kind: "signIn"; href: string }
  | { kind: "found"; assetId: string }
  | { kind: "notFound" };

export async function resolveScanTag(api: ServerApi | null, tag: string): Promise<ScanResult> {
  // RULE (build brief item 5): signed out goes through the sign-in gate with
  // `next=` set, so the technician lands back on this same tag once signed in.
  if (!api) return { kind: "signIn", href: `/sign-in?next=${encodeURIComponent(`/a/${tag}`)}` };

  const asset = await api.get(`/assets/by-tag/${encodeURIComponent(tag)}`, Asset).catch(() => null);
  return asset ? { kind: "found", assetId: asset.id } : { kind: "notFound" };
}
