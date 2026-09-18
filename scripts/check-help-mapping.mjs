#!/usr/bin/env node
// R48: every screen route must map to a manual section that exists in both
// languages. A new page.tsx without an entry in apps/web/src/help/map.json fails CI.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const appDir = resolve(root, "apps/web/src/app");
const map = JSON.parse(readFileSync(resolve(root, "apps/web/src/help/map.json"), "utf8"));

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

function routeOf(pagePath) {
  const rel = relative(appDir, pagePath).replace(/\\/g, "/").replace(/\/?page\.tsx$/, "");
  const segs = rel.split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

const problems = [];
const routes = walk(appDir).map(routeOf);
const byRoute = new Map(Object.entries(map).map(([id, e]) => [e.route, { id, ...e }]));

for (const r of routes) {
  const entry = byRoute.get(r);
  if (!entry) { problems.push(`route ${r} has no entry in help/map.json`); continue; }
  for (const lang of ["el", "en"]) {
    const f = resolve(root, "docs/manual", lang, `${entry.section}.md`);
    if (!existsSync(f)) problems.push(`${entry.id} (${r}): docs/manual/${lang}/${entry.section}.md is missing`);
  }
}

if (problems.length) {
  console.error(`help mapping check failed (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`help mapping ok: ${routes.length} routes mapped`);
