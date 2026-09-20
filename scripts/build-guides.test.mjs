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
  buildDividerHtml,
  buildDocumentHtml,
  buildTocHtml,
  collectPersonaChapters,
  compareScreenIds,
  countPdfPages,
  dividerLabel,
  extractTitle,
  formatDate,
  parseScreenId,
  splitChaptersByTier,
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

test("buildCoverHtml lists the day-one screens when given titles, escaped", () => {
  const html = buildCoverHtml({
    lang: "el",
    personaLabel: "x",
    version: "v",
    dateLabel: "d",
    logoSrc: "l",
    dayOneTitles: ["Χαρτοφυλάκιο έργων", "<b>Έργα</b>"],
  });
  assert.match(html, /class="day-one"/);
  assert.match(html, /Χαρτοφυλάκιο έργων/);
  assert.match(html, /&lt;b&gt;Έργα&lt;\/b&gt;/);
});

test("buildCoverHtml renders no day-one list when the titles are omitted", () => {
  const html = buildCoverHtml({ lang: "el", personaLabel: "x", version: "v", dateLabel: "d", logoSrc: "l" });
  assert.ok(!html.includes("day-one"));
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
    S09: { route: "/certs", section: "S09-payment-certs", tier: "day-one", persona: ["finance"] },
    "S09-new": { route: "/certs/new", section: "S09-payment-certs", tier: "day-one", persona: ["finance"] },
    S01: { route: "/", section: "S01-portfolio", tier: "day-one", persona: ["finance"] },
    S16: { route: "/areas", section: "S16-areas", tier: "day-one", persona: ["estates_head"] },
  };
  const chapters = collectPersonaChapters(map, "finance");
  assert.deepEqual(
    chapters.map((c) => c.section),
    ["S01-portfolio", "S09-payment-certs"],
  );
});

test("collectPersonaChapters returns nothing for a persona with no mapped sections", () => {
  const map = { S01: { route: "/", section: "S01-portfolio", tier: "day-one", persona: ["finance"] } };
  assert.deepEqual(collectPersonaChapters(map, "technician"), []);
});

test("collectPersonaChapters carries the representative id's own tier", () => {
  const map = {
    S01: { route: "/", section: "S01-portfolio", tier: "day-one", persona: ["finance"] },
    S06: { route: "/risks", section: "S06-risks-issues", tier: "optional", persona: ["finance"] },
  };
  const chapters = collectPersonaChapters(map, "finance");
  assert.deepEqual(
    chapters.map((c) => [c.id, c.tier]),
    [
      ["S01", "day-one"],
      ["S06", "optional"],
    ],
  );
});

// --- tier ordering (owner decision 20/09/2026 — docs/briefs/README.md
// Errata "Screen tiers"; build task item 3) --------------------------------

test("splitChaptersByTier separates day-one from optional, each keeping its order", () => {
  const chapters = [
    { id: "S01", tier: "day-one" },
    { id: "S06", tier: "optional" },
    { id: "S02", tier: "day-one" },
    { id: "S11", tier: "optional" },
  ];
  const { dayOne, optional } = splitChaptersByTier(chapters);
  assert.deepEqual(dayOne.map((c) => c.id), ["S01", "S02"]);
  assert.deepEqual(optional.map((c) => c.id), ["S06", "S11"]);
});

test("dividerLabel matches the exact bilingual wording the build task fixed", () => {
  assert.equal(dividerLabel("el"), "Προαιρετικές οθόνες — φάση 2");
  assert.equal(dividerLabel("en"), "Optional screens — phase 2");
});

test("buildDividerHtml renders the divider's own page with that label", () => {
  const html = buildDividerHtml({ lang: "el" });
  assert.match(html, /class="divider"/);
  assert.match(html, /Προαιρετικές οθόνες — φάση 2/);
});

test("buildTocHtml inserts the divider row right before the first optional chapter", () => {
  const chapters = [
    { id: "S01", title: "Α" },
    { id: "S02", title: "Β" },
    { id: "S06", title: "Γ" },
  ];
  const html = buildTocHtml({ lang: "el", chapters, dayOneCount: 2 });
  const dividerIndex = html.indexOf("toc-divider");
  const s06Index = html.indexOf("chapter-S06");
  const s02Index = html.indexOf("chapter-S02");
  assert.ok(dividerIndex > s02Index && dividerIndex < s06Index, "divider row sits between S02 and S06");
});

test("buildTocHtml omits the divider row when every chapter is day-one", () => {
  const chapters = [{ id: "S01", title: "Α" }];
  const html = buildTocHtml({ lang: "el", chapters, dayOneCount: 1 });
  assert.ok(!html.includes("toc-divider"));
});

test("buildDocumentHtml orders day-one chapters, then the divider, then optional chapters", () => {
  const chapters = [
    { id: "S06", section: "S06-risks-issues", tier: "optional", title: "Κίνδυνοι", bodyHtml: "<h1>Κίνδυνοι</h1><p>x</p>" },
    { id: "S01", section: "S01-portfolio", tier: "day-one", title: "Χαρτοφυλάκιο", bodyHtml: "<h1>Χαρτοφυλάκιο</h1><p>y</p>" },
  ];
  const html = buildDocumentHtml({
    lang: "el",
    personaLabel: "Οικονομική Διεύθυνση",
    version: "abc1234",
    dateLabel: "01/06/2026",
    logoSrc: "l",
    chapters,
  });
  const s01Index = html.indexOf('id="chapter-S01"');
  const dividerIndex = html.indexOf('class="divider"');
  const s06Index = html.indexOf('id="chapter-S06"');
  assert.ok(s01Index > -1 && dividerIndex > s01Index && s06Index > dividerIndex);
});

test("buildDocumentHtml's cover lists only the day-one chapter titles", () => {
  const chapters = [
    { id: "S06", section: "S06-risks-issues", tier: "optional", title: "Κίνδυνοι", bodyHtml: "<h1>Κίνδυνοι</h1><p>x</p>" },
    { id: "S01", section: "S01-portfolio", tier: "day-one", title: "Χαρτοφυλάκιο", bodyHtml: "<h1>Χαρτοφυλάκιο</h1><p>y</p>" },
  ];
  const html = buildDocumentHtml({
    lang: "el",
    personaLabel: "Οικονομική Διεύθυνση",
    version: "abc1234",
    dateLabel: "01/06/2026",
    logoSrc: "l",
    chapters,
  });
  const coverEnd = html.indexOf("</section>");
  const cover = html.slice(0, coverEnd);
  assert.match(cover, /Χαρτοφυλάκιο/);
  assert.ok(!cover.includes("Κίνδυνοι"));
});

test("buildDocumentHtml omits the divider page entirely when a persona has no optional chapters", () => {
  const chapters = [{ id: "S01", section: "S01-portfolio", tier: "day-one", title: "Χαρτοφυλάκιο", bodyHtml: "<h1>Χαρτοφυλάκιο</h1><p>y</p>" }];
  const html = buildDocumentHtml({
    lang: "el",
    personaLabel: "Οικονομική Διεύθυνση",
    version: "abc1234",
    dateLabel: "01/06/2026",
    logoSrc: "l",
    chapters,
  });
  assert.ok(!html.includes('class="divider"'));
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
