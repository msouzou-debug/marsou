#!/usr/bin/env node
// R46: fail the build when a key exists in one language file and not the other.
// Also flags empty strings and, in Greek, exclamation marks and the Latin
// question mark at the end of a sentence (UI instructions §3).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.cwd(), "apps/web/src/i18n");
const el = JSON.parse(readFileSync(resolve(dir, "el.json"), "utf8"));
const en = JSON.parse(readFileSync(resolve(dir, "en.json"), "utf8"));

function flatten(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

const elKeys = flatten(el);
const enKeys = flatten(en);
const problems = [];

for (const k of elKeys.keys()) if (!enKeys.has(k)) problems.push(`missing in en.json: ${k}`);
for (const k of enKeys.keys()) if (!elKeys.has(k)) problems.push(`missing in el.json: ${k}`);

for (const [k, v] of elKeys) {
  if (typeof v !== "string") continue;
  if (v.trim() === "") problems.push(`empty Greek string: ${k}`);
  if (v.includes("!")) problems.push(`exclamation mark in Greek string: ${k}`);
  if (/\?\s*$/.test(v)) problems.push(`Latin question mark in Greek string (use ;): ${k}`);
}
for (const [k, v] of enKeys) {
  if (typeof v === "string" && v.trim() === "") problems.push(`empty English string: ${k}`);
}

if (problems.length) {
  console.error(`i18n parity check failed (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`i18n parity ok: ${elKeys.size} keys in both languages`);
