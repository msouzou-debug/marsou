#!/usr/bin/env node
// R50 — per-persona printable PDF guides, generated from the manual source
// at release (build brief §6.1 "Printable PDF"; §14: assembled at M3,
// refreshed at every release after that). See docs/adr/ADR-0027-persona-guides.md
// for the full design and the index.json schema.
//
// For each of the eight personas in apps/web/src/help/map.json and each
// language (el, en), assembles every manual section that persona is listed
// for — in screen order, one section per chapter, each section counted once
// even if several routes point at it — into a single HTML document (cover,
// table of contents, chapters), then prints that document to PDF with
// Playwright's Chromium, the same engine and sandbox override
// apps/web/e2e/support.ts uses for the e2e suite.
//
// Output: apps/web/public/guides/<persona>.<lang>.pdf (16 files today) and
// apps/web/public/guides/index.json (size, page count, sha256 per file).
// Both are gitignored — they are release artefacts, rebuilt by
// `pnpm guides:build` (this script), wired into CI (.github/workflows/ci.yml)
// and into deploy/release.sh so a release always ships fresh PDFs.
//
// Run: `pnpm guides:build` from the repo root, or `node scripts/build-guides.mjs`.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { findInvalidTiers, findMissingManualSections } from "./check-help-mapping.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_ROOT = resolve(ROOT, "apps/web");
const MANUAL_ROOT = resolve(ROOT, "docs/manual");
const GUIDES_DIR = resolve(WEB_ROOT, "public/guides");
const MAP_PATH = resolve(WEB_ROOT, "src/help/map.json");
const LOGO_PATH = resolve(ROOT, "brand/logo/okypy_logo_full.png");

// The eight personas (build brief §1, R02), in the order they read best in —
// matches the key order of the `roles` block in apps/web/src/i18n/{el,en}.json.
export const PERSONA_ORDER = [
  "admin",
  "estates_head",
  "project_engineer",
  "technician",
  "finance",
  "clinical_approver",
  "executive_readonly",
  "auditor_readonly",
];

export const LANGS = ["el", "en"];

// The sandbox's preinstalled Chromium (see apps/web/e2e/support.ts for the
// same override and why). Falls back to Playwright's own managed browser
// when that path does not exist — e.g. after `playwright install chromium`
// on a normal CI runner — so this script is not sandbox-only.
const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// --------------------------------------------------------------- helpers --

/** `S02a-new` -> { num: 2, letters: "a", rest: "new" }; unparseable ids sort last. */
export function parseScreenId(id) {
  const m = /^S(\d+)([a-z]*)(?:-(.+))?$/i.exec(id);
  if (!m) return { num: Number.MAX_SAFE_INTEGER, letters: id.toLowerCase(), rest: "" };
  return { num: parseInt(m[1], 10), letters: (m[2] ?? "").toLowerCase(), rest: (m[3] ?? "").toLowerCase() };
}

export function compareScreenIds(a, b) {
  const pa = parseScreenId(a);
  const pb = parseScreenId(b);
  if (pa.num !== pb.num) return pa.num - pb.num;
  if (pa.letters !== pb.letters) return pa.letters < pb.letters ? -1 : 1;
  if (pa.rest !== pb.rest) return pa.rest < pb.rest ? -1 : 1;
  return 0;
}

/**
 * Every manual section a persona is listed for, in screen order, each
 * section once — several map.json ids (S09, S09-new, S09-detail, …) can name
 * the same section, and the persona reads that manual page once, not three
 * times. Returns `[{ id, section, tier }]`, `id` being the lowest-sorting
 * map.json id that named the section (used only to order sections against
 * each other), `tier` that id's own `"day-one" | "optional"` (owner decision
 * 20/09/2026 — docs/briefs/README.md Errata "Screen tiers"; every id naming
 * one section carries the same tier, enforced by `findInvalidTiers` running
 * on the whole map before this ever runs — see `main()`).
 */
export function collectPersonaChapters(map, persona) {
  const idsBySection = new Map();
  for (const [id, entry] of Object.entries(map)) {
    if (!entry.persona.includes(persona)) continue;
    const ids = idsBySection.get(entry.section) ?? [];
    ids.push(id);
    idsBySection.set(entry.section, ids);
  }
  const chapters = [...idsBySection.entries()].map(([section, ids]) => {
    ids.sort(compareScreenIds);
    return { id: ids[0], section, tier: map[ids[0]].tier };
  });
  chapters.sort((a, b) => compareScreenIds(a.id, b.id));
  return chapters;
}

/**
 * Splits a persona's chapters (already in screen order, from
 * `collectPersonaChapters`) into day-one and optional, each keeping its
 * relative screen order — the split the PDF guide's body, table of contents
 * and cover page all key off (build task, item 3: "day-one first, then a
 * divider page … then the optional chapters").
 */
export function splitChaptersByTier(chapters) {
  return {
    dayOne: chapters.filter((c) => c.tier === "day-one"),
    optional: chapters.filter((c) => c.tier !== "day-one"),
  };
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The manual section's own title: its first `# ` heading, verbatim. */
export function extractTitle(markdown) {
  const m = /^#\s+(.+)$/m.exec(markdown);
  return m ? m[1].trim() : "";
}

/** DD/MM/YYYY — the Cyprus date format used everywhere else in this brand. */
export function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}

export function gitShortSha(root) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    // No git history (e.g. a fresh export) — the guide still needs a
    // version string, so it says as much instead of crashing the build.
    return "unversioned";
  }
}

// -------------------------------------------------------------- HTML/CSS --

const PRINT_CSS = `
  @page { size: A4; margin: 22mm 18mm 20mm 18mm; }
  :root {
    --brand-blue: #1B75BB; /* headings only — CAPEX conventions: no other decorative blue fill */
    --ink: #1F2224;
    --text: #333333;
    --muted: #58595B;
    --rule: #EAEAEA;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Arial, "Helvetica Neue", "Liberation Sans", sans-serif;
    font-size: 14px; /* minimum text size anywhere in the document */
    line-height: 1.6;
    color: var(--text);
  }
  h1, h2, h3, h4 { color: var(--brand-blue); font-weight: 700; line-height: 1.3; }
  h1 { font-size: 24px; margin: 0 0 12px; }
  h2 { font-size: 18px; margin: 28px 0 10px; }
  h3 { font-size: 16px; margin: 20px 0 8px; }
  p, li { font-size: 14px; }
  a { color: inherit; text-decoration: underline; }
  ul, ol { padding-left: 22px; }
  strong { color: var(--ink); }
  hr { border: none; border-top: 1px solid var(--rule); margin: 16px 0; }

  .cover {
    page-break-after: always;
    min-height: 250mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .cover img.logo { width: 200px; height: auto; margin-bottom: 32px; }
  .cover .title-primary { font-size: 28px; color: var(--brand-blue); font-weight: 700; margin: 0; }
  .cover .title-secondary { font-size: 16px; color: var(--muted); margin: 6px 0 40px; }
  .cover .role { font-size: 20px; color: var(--ink); font-weight: 700; margin-bottom: 24px; }
  .cover .meta { font-size: 14px; color: var(--muted); margin-top: auto; }
  .cover .meta div { margin: 2px 0; }

  .cover .day-one { width: 100%; max-width: 420px; margin-bottom: 24px; }
  .cover .day-one-heading { font-size: 13px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 8px; }
  .cover .day-one-list { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 20px; font-size: 12px; line-height: 1.5; color: var(--text); text-align: left; }
  .cover .day-one-list li { break-inside: avoid; }

  .toc { page-break-after: always; }
  .toc h2 { margin-top: 0; }
  .toc ol { list-style: none; margin: 0; padding: 0; }
  .toc li {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 0;
    border-bottom: 1px dotted var(--rule);
    font-size: 14px;
  }
  .toc li .toc-id { color: var(--muted); min-width: 4em; }
  .toc li .toc-title { flex: 1; text-align: left; }
  .toc li.toc-divider {
    display: block;
    border-bottom: none;
    padding: 16px 0 4px;
    font-size: 13px;
    font-weight: 700;
    color: var(--brand-blue);
    text-transform: uppercase;
    letter-spacing: .04em;
  }

  .chapter { page-break-before: always; }
  .chapter .chapter-id { font-size: 14px; color: var(--muted); font-weight: 700; margin-bottom: 2px; }

  /* Owner decision 20/09/2026 (docs/briefs/README.md Errata "Screen tiers"):
     the divider page that separates the day-one chapters from the optional
     ones — its own page, so a reader flipping through immediately sees the
     guide is done with what training covers and is starting the phase-two
     material. */
  .divider { page-break-before: always; page-break-after: always; min-height: 250mm; display: flex; align-items: center; justify-content: center; text-align: center; }
  .divider h2 { font-size: 22px; margin: 0; }

  .what-can-go-wrong-note { font-size: 14px; color: var(--muted); }
`;

function coverTitleFor(lang) {
  return lang === "en"
    ? { primary: "eCapital — User guide", secondary: "eCapital — Οδηγός χρήσης" }
    : { primary: "eCapital — Οδηγός χρήσης", secondary: "eCapital — User guide" };
}

/**
 * The cover page's HTML, pure and self-contained: no filesystem or process
 * access, so it is what scripts/build-guides.test.mjs exercises against
 * scripts/fixtures/sample-cover.html. `logoSrc` is any `<img src>` value —
 * the real build passes a `data:` URI so the finished PDF has no external
 * file reference; the test passes a short placeholder to keep the fixture
 * readable.
 *
 * `dayOneTitles` (owner decision 20/09/2026 — docs/briefs/README.md Errata
 * "Screen tiers") lists this persona's day-one screens by title, so training
 * can see at a glance what the pilot actually covers on day one without
 * opening the guide. Omitted (or empty) renders no list at all — a persona
 * with zero day-one screens is not expected today, but the cover degrades
 * cleanly rather than showing an empty heading.
 */
export function buildCoverHtml({ lang, personaLabel, version, dateLabel, logoSrc, dayOneTitles = [] }) {
  const title = coverTitleFor(lang);
  const dayOneHeading = lang === "en" ? "Day one" : "Ημέρα 1";
  const dayOneList =
    dayOneTitles.length === 0
      ? ""
      : `<div class="day-one">
      <p class="day-one-heading">${escapeHtml(dayOneHeading)}</p>
      <ul class="day-one-list">${dayOneTitles.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
    </div>
    `;
  return `<section class="cover">
    <img class="logo" src="${escapeHtml(logoSrc)}" alt="ΟΚΥπΥ" />
    <p class="title-primary">${escapeHtml(title.primary)}</p>
    <p class="title-secondary">${escapeHtml(title.secondary)}</p>
    <p class="role">${escapeHtml(personaLabel)}</p>
    ${dayOneList}<div class="meta">
      <div>${lang === "en" ? "Version" : "Έκδοση"}: ${escapeHtml(version)}</div>
      <div>${lang === "en" ? "Date" : "Ημερομηνία"}: ${escapeHtml(dateLabel)}</div>
    </div>
  </section>`;
}

// Owner decision 20/09/2026 (docs/briefs/README.md Errata "Screen tiers");
// the exact bilingual wording the task fixed for the divider page and the
// table-of-contents separator row.
export function dividerLabel(lang) {
  return lang === "en" ? "Optional screens — phase 2" : "Προαιρετικές οθόνες — φάση 2";
}

/**
 * The divider page's HTML: its own page (`.divider`'s CSS forces a page
 * break before and after it), so a reader paging through the PDF lands on
 * it exactly between the day-one chapters and the optional ones.
 */
export function buildDividerHtml({ lang }) {
  return `<section class="divider"><h2>${escapeHtml(dividerLabel(lang))}</h2></section>`;
}

/**
 * `chapters` is the full, tier-ordered list (day-one chapters, then the
 * optional ones — see `splitChaptersByTier`). When there is at least one
 * optional chapter, a non-clickable `.toc-divider` row is printed right
 * before it, the same `dividerLabel` the divider page itself uses, so the
 * table of contents reads as one list with the split visible in it.
 */
export function buildTocHtml({ lang, chapters, dayOneCount }) {
  const heading = lang === "en" ? "Contents" : "Περιεχόμενα";
  const items = chapters
    .map((c, i) => {
      const divider =
        dayOneCount != null && i === dayOneCount && i < chapters.length
          ? `<li class="toc-divider">${escapeHtml(dividerLabel(lang))}</li>`
          : "";
      return `${divider}<li><span class="toc-id">${escapeHtml(c.id)}</span><span class="toc-title"><a href="#chapter-${escapeHtml(c.id)}">${escapeHtml(c.title)}</a></span></li>`;
    })
    .join("\n");
  return `<section class="toc"><h2>${heading}</h2><ol>${items}</ol></section>`;
}

export function buildChapterHtml({ id, title, bodyHtml }) {
  // The section's own "# Title" line is dropped from the rendered body (it
  // is reproduced here, next to the screen id, as the chapter heading) so
  // it is not shown twice.
  const withoutTitle = bodyHtml.replace(/^<h1[^>]*>.*?<\/h1>\s*/, "");
  return `<section class="chapter" id="chapter-${escapeHtml(id)}">
    <div class="chapter-id">${escapeHtml(id)}</div>
    <h1>${escapeHtml(title)}</h1>
    ${withoutTitle}
  </section>`;
}

/**
 * Assembles the full document: cover (listing the day-one screens), table of
 * contents, the day-one chapters, a divider page, then the optional
 * chapters — owner decision 20/09/2026 (docs/briefs/README.md Errata
 * "Screen tiers"; build task item 3). `chapters` is each `{ id, section,
 * tier, title, bodyHtml }` in screen order (as `main()` builds them from
 * `collectPersonaChapters`); the day-one/optional split and the divider's
 * placement are entirely this function's job so a caller only ever hands it
 * one ordered list.
 */
export function buildDocumentHtml({ lang, personaLabel, version, dateLabel, logoSrc, chapters }) {
  const title = coverTitleFor(lang);
  const { dayOne, optional } = splitChaptersByTier(chapters);
  const ordered = [...dayOne, ...optional];

  const cover = buildCoverHtml({ lang, personaLabel, version, dateLabel, logoSrc, dayOneTitles: dayOne.map((c) => c.title) });
  const toc = buildTocHtml({ lang, chapters: ordered, dayOneCount: dayOne.length });
  const dayOneHtml = dayOne.map(buildChapterHtml).join("\n");
  const divider = optional.length > 0 ? buildDividerHtml({ lang }) : "";
  const optionalHtml = optional.map(buildChapterHtml).join("\n");

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title.primary)} — ${escapeHtml(personaLabel)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${cover}
${toc}
${dayOneHtml}
${divider}
${optionalHtml}
</body>
</html>`;
}

// ------------------------------------------------------------- PDF pages --

/**
 * One `/Type /Page` object per page (never `/Pages`, the parent node in
 * Chromium's page tree — the tree is split into groups of a handful of
 * leaves each, every group carrying its own `/Count`, so summing those is
 * more fragile than counting leaves directly). Verified against this
 * build's Skia PDF backend, which — for the documents this script produces
 * — writes plain, uncompressed objects (no `/ObjStm` object streams), so a
 * byte-level scan is reliable without a PDF-parsing dependency just to
 * count pages.
 */
export function countPdfPages(buffer) {
  const text = buffer.toString("latin1");
  return (text.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

const FOOTER_TEMPLATE = `
  <div style="width:100%; font-size:9px; color:#8A8C8F; text-align:center; font-family:Arial,sans-serif;">
    <span class="pageNumber"></span> / <span class="totalPages"></span>
  </div>
`;

async function renderPdf(browser, html) {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: "22mm", bottom: "20mm", left: "18mm", right: "18mm" },
    });
  } finally {
    await page.close();
  }
}

// ------------------------------------------------------------------ main --

async function main() {
  const map = JSON.parse(readFileSync(MAP_PATH, "utf8"));

  // Fail fast (R50 + this script's own CI job): a persona guide built from
  // a manual section that does not exist would be silently incomplete, and
  // one built from a screen with no tier decision would silently put it in
  // the wrong half of the guide. Both `findMissingManualSections` and
  // `findInvalidTiers` are the same rules `pnpm check:help` runs.
  const problems = [...findMissingManualSections(ROOT, map), ...findInvalidTiers(map)];
  if (problems.length) {
    console.error(`guides:build aborted — ${problems.length} problem(s) in help/map.json:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const roleLabels = {
    el: JSON.parse(readFileSync(resolve(WEB_ROOT, "src/i18n/el.json"), "utf8")).roles,
    en: JSON.parse(readFileSync(resolve(WEB_ROOT, "src/i18n/en.json"), "utf8")).roles,
  };

  const version = gitShortSha(ROOT);
  const dateLabel = formatDate(new Date());
  const logoSrc = `data:image/png;base64,${readFileSync(LOGO_PATH).toString("base64")}`;

  mkdirSync(GUIDES_DIR, { recursive: true });

  const require = createRequire(resolve(WEB_ROOT, "package.json"));
  const { chromium } = require("@playwright/test");
  const launchOptions = existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {};
  const browser = await chromium.launch(launchOptions);

  const guides = [];
  let built = 0;
  let skipped = 0;

  try {
    for (const persona of PERSONA_ORDER) {
      const chapterRefs = collectPersonaChapters(map, persona);
      if (chapterRefs.length === 0) {
        console.log(`skip: ${persona} — no manual sections mapped to this persona in help/map.json`);
        skipped += 1;
        continue;
      }

      for (const lang of LANGS) {
        const chapters = chapterRefs.map(({ id, section, tier }) => {
          const markdown = readFileSync(resolve(MANUAL_ROOT, lang, `${section}.md`), "utf8");
          return { id, section, tier, title: extractTitle(markdown), bodyHtml: marked.parse(markdown) };
        });

        const personaLabel = roleLabels[lang][persona] ?? persona;
        const html = buildDocumentHtml({ lang, personaLabel, version, dateLabel, logoSrc, chapters });
        const pdfBuffer = await renderPdf(browser, html);

        const fileName = `${persona}.${lang}.pdf`;
        writeFileSync(resolve(GUIDES_DIR, fileName), pdfBuffer);

        const pages = countPdfPages(pdfBuffer);
        const sha256 = createHash("sha256").update(pdfBuffer).digest("hex");
        guides.push({
          persona,
          lang,
          file: fileName,
          personaLabel,
          sections: chapters.length,
          sizeBytes: pdfBuffer.length,
          pages,
          sha256,
        });
        built += 1;
        console.log(
          `built ${fileName} — ${chapters.length} sections, ${pages} pages, ${(pdfBuffer.length / 1024).toFixed(0)} KB`,
        );
      }
    }
  } finally {
    await browser.close();
  }

  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version,
    guides,
  };
  writeFileSync(resolve(GUIDES_DIR, "index.json"), JSON.stringify(index, null, 2) + "\n");

  console.log(`\nguides:build done — ${built} PDF(s) built, ${skipped} persona(s) skipped (no mapped sections).`);
}

// Only run the build when this file is executed directly (`node
// build-guides.mjs` / `pnpm guides:build`) — importing it for its exported
// pure functions (scripts/build-guides.test.mjs) must not launch a browser
// and rebuild all sixteen PDFs as a side effect.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
