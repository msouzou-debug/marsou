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

/**
 * Every `docs/manual/<lang>/<section>.md` that a `help/map.json` entry names
 * but that is missing from disk, as human-readable strings. `map` is the
 * parsed map.json object (id -> { route, section, persona }); `root` is the
 * repo root the "docs/manual" path is resolved against.
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

  const problems = findMissingManualSections(root, map);

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
