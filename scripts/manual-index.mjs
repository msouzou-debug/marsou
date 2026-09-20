#!/usr/bin/env node
// Generates docs/manual/README.md: a two-language index of every screen in
// apps/web/src/help/map.json — its title in each language (read the same
// way scripts/build-guides.mjs does, off the manual section's own "# "
// heading), its tier (owner decision 20/09/2026 — docs/briefs/README.md
// Errata "Screen tiers") and the personas that use it.
//
// Run: `pnpm guides:build` (this runs first, then scripts/build-guides.mjs)
// or `node scripts/manual-index.mjs` on its own. The output is committed —
// this is a small generator over data that only changes when a screen, its
// manual section or its tier changes, not a build artefact regenerated on
// every install (unlike the sixteen PDFs, which are gitignored).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareScreenIds, extractTitle } from "./build-guides.mjs";
import { findInvalidTiers, findMissingManualSections } from "./check-help-mapping.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ROOT = resolve(ROOT, "apps/web");
const MANUAL_ROOT = resolve(ROOT, "docs/manual");
const MAP_PATH = resolve(WEB_ROOT, "src/help/map.json");
const OUT_PATH = resolve(MANUAL_ROOT, "README.md");

// Screens the M4 (assets) web agent is adding directly on the main
// checkout, in parallel with this change — see docs/briefs/README.md Errata
// "Screen tiers" and this repo's build task. They are not yet routes in
// help/map.json (no page.tsx, no manual section), so `pnpm check:help`
// cannot see them and this script cannot read a title for them off disk;
// the tier decision is recorded here by hand until they land in the map,
// at which point this list is deleted and the real rows appear in the
// generated table below on the next `pnpm guides:build`.
const PLANNED_M4_SCREENS = [
  { label: "Asset register", tier: "day-one" },
  { label: "Asset detail", tier: "day-one" },
  { label: "Asset form (new / edit)", tier: "day-one" },
  { label: "Label sheet (print)", tier: "day-one" },
  { label: "Scan route", tier: "day-one" },
  { label: "Asset replacement forecast", tier: "optional" },
];

function loadMap() {
  return JSON.parse(readFileSync(MAP_PATH, "utf8"));
}

/** One row per manual section (several map.json ids can name the same
 *  section — S09, S09-new, S09-detail — and the index lists that screen
 *  once), grouped by tier, each group in screen order. Mirrors
 *  apps/web/src/help/list-screens-by-tier.ts's dedup rule, which the S26
 *  help centre's screen list uses for the same reason. */
export function buildRows(map) {
  const bySection = new Map();
  for (const [id, entry] of Object.entries(map)) {
    const existing = bySection.get(entry.section);
    if (existing) {
      existing.ids.push(id);
      for (const p of entry.persona) if (!existing.persona.includes(p)) existing.persona.push(p);
    } else {
      bySection.set(entry.section, { tier: entry.tier, ids: [id], persona: [...entry.persona] });
    }
  }

  const rows = [...bySection.entries()].map(([section, { tier, ids, persona }]) => {
    ids.sort(compareScreenIds);
    const titleEl = extractTitle(readFileSync(resolve(MANUAL_ROOT, "el", `${section}.md`), "utf8"));
    const titleEn = extractTitle(readFileSync(resolve(MANUAL_ROOT, "en", `${section}.md`), "utf8"));
    return { id: ids[0], titleEl, titleEn, tier, persona };
  });
  rows.sort((a, b) => compareScreenIds(a.id, b.id));
  return rows;
}

function mdEscape(value) {
  return String(value).replace(/\|/g, "\\|");
}

function tableFor(rows) {
  const header = "| Screen id | Title (EL) | Title (EN) | Personas |\n|---|---|---|---|";
  const lines = rows.map(
    (r) => `| ${mdEscape(r.id)} | ${mdEscape(r.titleEl)} | ${mdEscape(r.titleEn)} | ${mdEscape(r.persona.join(", "))} |`,
  );
  return [header, ...lines].join("\n");
}

function plannedTableFor(rows) {
  const header = "| Screen | Planned tier |\n|---|---|";
  const lines = rows.map((r) => `| ${mdEscape(r.label)} | ${r.tier === "day-one" ? "Day one" : "Optional"} |`);
  return [header, ...lines].join("\n");
}

export function buildReadme(rows, plannedRows) {
  const dayOne = rows.filter((r) => r.tier === "day-one");
  const optional = rows.filter((r) => r.tier === "optional");

  return `# eCapital user manual

One Markdown file per screen, in \`el/\` and \`en/\`, the single source \`apps/web/src/help/\` renders three ways: the S25 contextual help drawer, the S26 help centre, and the sixteen printable PDF guides (R50, ADR-0027). The table below is generated from \`apps/web/src/help/map.json\` by \`scripts/manual-index.mjs\` — run \`pnpm guides:build\` (which runs this script first) after adding a screen or changing a tier, and commit the result; do not hand-edit the table.

## Tiers and what "day one" means for training

Owner decision, 20/09/2026 (docs/briefs/README.md Errata "Screen tiers"): the pilot goes live on a capital-and-maintenance basis, so every screen below is either **day one** or **optional**. A day-one screen is one the pilot's training covers before go-live and every user of that screen's persona is expected to use starting their first day on the system — it is in the persona's PDF guide's main chapters and in the S25/S26 UI's "Ημέρα 1" group. An optional screen is built, shipped and reachable in the app from day one as well, but training treats it as phase two: it sits after the guide's divider page and under S26's "Προαιρετικό" group, and a hospital picks it up once the basic register is running, not before.

## Screens (generated — do not edit by hand)

### Day one

${tableFor(dayOne)}

### Optional

${tableFor(optional)}

## M4 asset screens — tier decided, not yet in help/map.json

The asset register, asset detail, asset form, the label sheet and the scan route are being added directly on the main checkout by the M4 web agent, in parallel with this change. They have no route in \`help/map.json\` yet, so \`scripts/manual-index.mjs\` cannot read a title for them and they are not in the generated table above. The tier decision for them still stands (docs/briefs/README.md Errata "Screen tiers") and is recorded here by hand so it is not lost before M4 lands; once each screen gets its \`help/map.json\` entry (with its own \`tier\`), delete its row here and it appears in the generated table on the next \`pnpm guides:build\`.

${plannedTableFor(plannedRows)}
`;
}

function main() {
  const map = loadMap();

  const problems = [...findMissingManualSections(ROOT, map), ...findInvalidTiers(map)];
  if (problems.length) {
    console.error(`manual-index aborted — ${problems.length} problem(s) in help/map.json:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const rows = buildRows(map);
  const readme = buildReadme(rows, PLANNED_M4_SCREENS);
  writeFileSync(OUT_PATH, readme);
  console.log(`manual-index: wrote docs/manual/README.md — ${rows.length} screen(s) from help/map.json.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
