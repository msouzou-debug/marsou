#!/usr/bin/env node
// R48: every screen route must map to a manual section that exists in both
// languages. A new page.tsx without an entry in apps/web/src/help/map.json fails CI.
//
// `findMissingManualSections` is exported so other scripts that only care
// about "does every section this map names actually exist on disk" (R50's
// scripts/build-guides.mjs, in particular) can reuse the same rule instead
// of re-implementing it.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LANGS = ["el", "en"];

// Owner decision, 20/09/2026 (docs/briefs/README.md Errata "Screen tiers"):
// every screen is either trained and used from day one, or held back to
// phase two as optional. Mirrors apps/web/src/help/tier.ts's `Tier` union —
// duplicated here (rather than imported) because this script runs as plain
// Node outside apps/web's TypeScript build, the same boundary
// scripts/build-guides.mjs already crosses for PERSONA_ORDER.
const VALID_TIERS = new Set(["day-one", "optional"]);

/**
 * Every `docs/manual/<lang>/<section>.md` that a `help/map.json` entry names
 * but that is missing from disk, as human-readable strings. `map` is the
 * parsed map.json object (id -> { route, section, persona, tier }); `root`
 * is the repo root the "docs/manual" path is resolved against.
 */
export function findMissingManualSections(root, map) {
  const problems = [];
  for (const [id, entry] of Object.entries(map)) {
    for (const lang of LANGS) {
      const file = resolve(root, "docs/manual", lang, `${entry.section}.md`);
      if (!existsSync(file)) problems.push(`${id}: docs/manual/${lang}/${entry.section}.md is missing`);
    }
  }
  return problems;
}

/**
 * Every `help/map.json` entry whose `tier` is missing or is not one of
 * "day-one" / "optional", as human-readable strings — a screen with no tier
 * decision is not a screen the pilot has actually made a call on.
 */
export function findInvalidTiers(map) {
  const problems = [];
  for (const [id, entry] of Object.entries(map)) {
    if (!VALID_TIERS.has(entry.tier)) {
      const got = entry.tier === undefined ? "missing" : JSON.stringify(entry.tier);
      problems.push(`${id}: tier is ${got}, expected "day-one" or "optional"`);
    }
  }
  return problems;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      // preview is a dev-only gallery and api/ holds route handlers; neither is a screen.
      if (name === "preview" || name === "api") continue;
      walk(p, out);
    } else if (name === "page.tsx") out.push(p);
  }
  return out;
}

function routeOf(appDir, pagePath) {
  const rel = relative(appDir, pagePath).replace(/\\/g, "/").replace(/\/?page\.tsx$/, "");
  const segs = rel.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

function main() {
  const root = process.cwd();
  const appDir = resolve(root, "apps/web/src/app");
  const map = JSON.parse(readFileSync(resolve(root, "apps/web/src/help/map.json"), "utf8"));

  const problems = [...findMissingManualSections(root, map), ...findInvalidTiers(map)];

  const routes = walk(appDir).map((p) => routeOf(appDir, p));
  const byRoute = new Map(Object.entries(map).map(([id, e]) => [e.route, { id, ...e }]));
  for (const r of routes) {
    if (!byRoute.get(r)) problems.push(`route ${r} has no entry in help/map.json`);
  }

  if (problems.length) {
    console.error(`help mapping check failed (${problems.length}):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`help mapping ok: ${routes.length} routes mapped`);
}

// Only run the CLI when this file is executed directly (`node
// check-help-mapping.mjs`), not when `build-guides.mjs` imports
// `findMissingManualSections` from it.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
