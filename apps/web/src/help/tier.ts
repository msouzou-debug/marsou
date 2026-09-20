// Owner decision, 20/09/2026 (docs/briefs/README.md Errata "Screen tiers"):
// the pilot goes live on a capital-and-maintenance basis, so every screen in
// help/map.json is either "day-one" (trained and used from day one) or
// "optional" (phase two, available but not part of pilot training). This is
// the type both the web app (TierChip, the S26 screen list) and the tooling
// (scripts/check-help-mapping.mjs, scripts/build-guides.mjs,
// scripts/manual-index.mjs) share for it.
export type Tier = "day-one" | "optional";

export function isTier(value: unknown): value is Tier {
  return value === "day-one" || value === "optional";
}
