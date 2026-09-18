#!/usr/bin/env node
// R46: fail the build when a key exists in one language file and not the other.
// Also flags empty strings and, in Greek, exclamation marks and the Latin
// question mark at the end of a sentence (UI instructions §3).
//
// The API keeps its own el.json and en.json for error bodies, so the check
// takes the directory as an argument; scripts/check-api-i18n-parity.mjs calls
// it for apps/api/src/i18n and the root `check:i18n` runs both.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// JSON.parse silently keeps the last of two duplicate keys, which is how a
// merge can drop a whole block without any tool noticing. Refuse duplicates.
function parseStrict(file) {
  return checkDuplicates(readFileSync(file, "utf8"), file);
}
function checkDuplicates(text, file) {
  // Walk the text and track keys per object depth.
  const stack = [];
  let i = 0, inStr = false, esc = false, str = "", expectKey = false;
  const dups = [];
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      if (esc) { esc = false; str += c; }
      else if (c === "\\") esc = true;
      else if (c === '"') { inStr = false; if (expectKey) { const top = stack[stack.length - 1]; if (top.has(str)) dups.push(str); top.add(str); expectKey = false; } }
      else str += c;
    } else if (c === '"') { inStr = true; str = ""; }
    else if (c === "{") { stack.push(new Set()); expectKey = true; }
    else if (c === "}") { stack.pop(); }
    else if (c === ",") { const top = stack[stack.length - 1]; if (top) expectKey = true; }
    else if (c === ":") { expectKey = false; }
    else if (c === "[") { stack.push(null); }
    else if (c === "]") { stack.pop(); }
    i++;
  }
  if (dups.length) {
    console.error(`${file}: duplicate keys ${[...new Set(dups)].map((d) => `"${d}"`).join(", ")}`);
    process.exit(1);
  }
  return JSON.parse(text);
}

function flatten(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

export function checkI18nParity(relativeDir) {
  const dir = resolve(process.cwd(), relativeDir);
  const el = parseStrict(resolve(dir, "el.json"));
  const en = parseStrict(resolve(dir, "en.json"));
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
    console.error(`i18n parity check failed for ${relativeDir} (${problems.length}):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`i18n parity ok for ${relativeDir}: ${elKeys.size} keys in both languages`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  checkI18nParity(process.argv[2] ?? "apps/web/src/i18n");
}
