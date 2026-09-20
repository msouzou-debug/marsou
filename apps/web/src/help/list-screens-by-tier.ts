// Server-side loader for the S26 help centre's screen list (owner decision
// 20/09/2026 — docs/briefs/README.md Errata "Screen tiers"): every screen in
// help/map.json grouped into "day-one" and "optional", with the manual
// section's own title (its first `# ` heading, the same source
// load-section.ts reads) and the persona list, so training can point at one
// place for "what do we teach on day one".
//
// Several map.json ids can name the same manual section (S09, S09-new,
// S09-detail all point at S09-payment-certs) — this list shows that section
// once, the same dedup rule scripts/build-guides.mjs's
// collectPersonaChapters uses for the PDF guides' chapters, kept in sync by
// scripts/manual-index.test.mjs and this file's own test reading the real
// map.json and docs/manual.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Locale } from "@/i18n/config";
import type { Tier } from "./tier";
import helpMap from "./map.json";
import type { HelpMapEntry } from "./load-section";

const MANUAL_ROOT = resolve(process.cwd(), "../../docs/manual");

export interface TierScreen {
  /** The lowest-sorting map.json id naming this section, e.g. "S09". */
  id: string;
  /** The section's own "# " title in the requested locale, or the section
   *  slug itself if the file is missing (never throws). */
  title: string;
  /** Every persona listed against any map.json id for this section, union'd
   *  and in help/map.json's own persona order of first appearance. */
  persona: string[];
}

export interface ScreensByTier {
  dayOne: TierScreen[];
  optional: TierScreen[];
}

/** `S02a-new` -> { num: 2, letters: "a" }; mirrors
 *  scripts/build-guides.mjs's parseScreenId/compareScreenIds so the two
 *  screen lists (this one and the PDF guides' tables of contents) agree on
 *  "screen order" — duplicated rather than imported because this file is
 *  bundled into the Next.js app and that one is a repo-root Node script. */
function screenSortKey(id: string): [number, string, string] {
  const m = /^S(\d+)([a-z]*)(?:-(.+))?$/i.exec(id);
  if (!m) return [Number.MAX_SAFE_INTEGER, id.toLowerCase(), ""];
  return [parseInt(m[1], 10), (m[2] ?? "").toLowerCase(), (m[3] ?? "").toLowerCase()];
}

function compareScreenIds(a: string, b: string): number {
  const [na, la, ra] = screenSortKey(a);
  const [nb, lb, rb] = screenSortKey(b);
  if (na !== nb) return na - nb;
  if (la !== lb) return la < lb ? -1 : 1;
  if (ra !== rb) return ra < rb ? -1 : 1;
  return 0;
}

function titleOf(section: string, locale: Locale): string {
  try {
    const raw = readFileSync(resolve(MANUAL_ROOT, locale, `${section}.md`), "utf8");
    const match = /^#\s+(.+)$/m.exec(raw);
    return match ? match[1].trim() : section;
  } catch {
    // Missing manual file: `pnpm check:help` is what enforces it exists —
    // this list falls back to the section slug rather than crashing.
    return section;
  }
}

/** Every help/map.json screen, deduplicated by manual section, grouped by
 *  tier (day-one first), each group in screen order. */
export function listScreensByTier(locale: Locale): ScreensByTier {
  const bySection = new Map<string, { tier: Tier; ids: string[]; persona: string[] }>();

  for (const [id, entry] of Object.entries(helpMap as Record<string, HelpMapEntry>)) {
    const existing = bySection.get(entry.section);
    if (existing) {
      existing.ids.push(id);
      for (const p of entry.persona) if (!existing.persona.includes(p)) existing.persona.push(p);
    } else {
      bySection.set(entry.section, { tier: entry.tier, ids: [id], persona: [...entry.persona] });
    }
  }

  const screens: (TierScreen & { tier: Tier })[] = [...bySection.entries()].map(([section, { tier, ids, persona }]) => {
    ids.sort(compareScreenIds);
    return { id: ids[0], title: titleOf(section, locale), persona, tier };
  });
  screens.sort((a, b) => compareScreenIds(a.id, b.id));

  return {
    dayOne: screens.filter((s) => s.tier === "day-one").map(({ id, title, persona }) => ({ id, title, persona })),
    optional: screens.filter((s) => s.tier === "optional").map(({ id, title, persona }) => ({ id, title, persona })),
  };
}
