// Unit tests for scripts/build-guides.mjs's pure helpers (R50). Run with
// `node --test scripts/build-guides.test.mjs` (no vitest/workspace
// dependency — this script runs at the repo root, outside apps/web).
//
// scripts/fixtures/sample-cover.html is the "sample cover HTML fixture"
// referenced by docs/adr/ADR-0027-persona-guides.md: a known-good
// `buildCoverHtml()` output for a fixed input, so a change to the cover
// markup shows up as a diff here instead of only inside a generated PDF.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCoverHtml,
  collectPersonaChapters,
  compareScreenIds,
  countPdfPages,
  extractTitle,
  formatDate,
  parseScreenId,
} from "./build-guides.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("buildCoverHtml matches the sample fixture for a fixed input", () => {
  const html = buildCoverHtml({
    lang: "el",
    personaLabel: "Μηχανικός έργου",
    version: "abc1234",
    dateLabel: "01/06/2026",
    logoSrc: "logo-placeholder.png",
  });
  const fixture = readFileSync(resolve(HERE, "fixtures/sample-cover.html"), "utf8").replace(/\n$/, "");
  assert.equal(html, fixture);
});

test("buildCoverHtml puts the current language's title first", () => {
  const el = buildCoverHtml({ lang: "el", personaLabel: "x", version: "v", dateLabel: "d", logoSrc: "l" });
  const en = buildCoverHtml({ lang: "en", personaLabel: "x", version: "v", dateLabel: "d", logoSrc: "l" });
  assert.match(el, /title-primary">eCapital — Οδηγός χρήσης/);
  assert.match(en, /title-primary">eCapital — User guide/);
});

test("buildCoverHtml escapes its inputs", () => {
  const html = buildCoverHtml({ lang: "el", personaLabel: '<script>"x"</script>', version: "v", dateLabel: "d", logoSrc: "l" });
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("parseScreenId / compareScreenIds order screens numerically, then by letter suffix", () => {
  const ids = ["S10", "S02a-new", "S02", "S07b", "S07"];
  ids.sort(compareScreenIds);
  assert.deepEqual(ids, ["S02", "S02a-new", "S07", "S07b", "S10"]);
  assert.equal(parseScreenId("S02a-new").num, 2);
  assert.equal(parseScreenId("S02a-new").letters, "a");
  assert.equal(parseScreenId("S02a-new").rest, "new");
});

test("collectPersonaChapters counts a section once even when several ids name it, in screen order", () => {
  const map = {
    S09: { route: "/certs", section: "S09-payment-certs", persona: ["finance"] },
    "S09-new": { route: "/certs/new", section: "S09-payment-certs", persona: ["finance"] },
    S01: { route: "/", section: "S01-portfolio", persona: ["finance"] },
    S16: { route: "/areas", section: "S16-areas", persona: ["estates_head"] },
  };
  const chapters = collectPersonaChapters(map, "finance");
  assert.deepEqual(
    chapters.map((c) => c.section),
    ["S01-portfolio", "S09-payment-certs"],
  );
});

test("collectPersonaChapters returns nothing for a persona with no mapped sections", () => {
  const map = { S01: { route: "/", section: "S01-portfolio", persona: ["finance"] } };
  assert.deepEqual(collectPersonaChapters(map, "technician"), []);
});

test("extractTitle reads the section's first H1", () => {
  assert.equal(extractTitle("# Χαρτοφυλάκιο έργων\n\nΚείμενο."), "Χαρτοφυλάκιο έργων");
  assert.equal(extractTitle("no heading here"), "");
});

test("formatDate renders DD/MM/YYYY", () => {
  assert.equal(formatDate(new Date(2026, 0, 5)), "05/01/2026");
  assert.equal(formatDate(new Date(2026, 10, 23)), "23/11/2026");
});

test("countPdfPages counts /Type /Page objects, not /Type /Pages", () => {
  const buf = Buffer.from("1 0 obj << /Type /Pages /Count 2 >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj");
  assert.equal(countPdfPages(buf), 2);
});
