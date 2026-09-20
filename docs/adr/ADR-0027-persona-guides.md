# ADR-0027 — Per-persona PDF guides, generated from the manual at release

**Status:** accepted · 19/09/2026 · implements R50, builds on the embedded-manual design in CAPEX-01 §6.1

## Context

CAPEX-01 §6.1 asks for the manual to render three ways from one Markdown source under `docs/manual/{el,en}/`: the S25 contextual help drawer, the S26 help centre, and "one printable PDF guide per persona… generated on release, downloadable from inside the app and carrying the version number and date." §14 fixes the schedule: assembled at M3 for the pilot, refreshed at every release after that. R50 is the requirement number; §15's definition of done already requires every manual section to exist in both languages before a screen ships, which is what makes an automated assembly possible at all — the source is already complete by construction, R48/`pnpm check:help` enforce it.

Eight personas (build brief §1, R02) × two languages = sixteen PDFs.

## Decision

### Assembly and rendering

`scripts/build-guides.mjs` (Node, ESM, no Python):

1. Reads `apps/web/src/help/map.json`. For each persona, it collects every manual **section** that persona's routes are mapped to — several routes can name the same section (S09, S09-new, S09-detail all point at `S09-payment-certs`), and a persona reads that page once, not three times, so sections are deduplicated before assembly.
2. Orders sections by screen id: parses `S02a-new` into `{ num: 2, letters: "a", rest: "new" }` and sorts numerically first, then by the letter suffix. When several ids collapse to one section (the S09 example above), the lowest-sorting id represents it. This is a naming convention, not a hand-curated table of contents, so it is a reasonable read of "screen order" rather than an exact one — see Errata.
3. Refuses to run (`process.exit(1)`) if `map.json` names a section that does not exist in both languages, reusing `findMissingManualSections()`, exported from `scripts/check-help-mapping.mjs` for exactly this — `pnpm check:help` and `guides:build` enforce the same rule from one place. A persona with zero mapped sections is skipped with a console line, not an error (none of today's eight personas hit this, since S00 maps to all eight, but the rule is general).
4. Renders each section's Markdown to HTML with `marked` (the one new dependency this change adds, at the workspace root — `apps/web` already carries `react-markdown`/`remark-gfm` for the two in-app renderers, but those are React-tree renderers; this script produces a plain HTML string to hand to Chromium, which is what `marked` is for).
5. Assembles one HTML document per persona × language: a cover page, a table of contents, then one `<section class="chapter">` per manual section, in the order from step 2. Print CSS (`@page { size: A4; }`, 14px minimum text anywhere in the content, brand blue — `#1B75BB`, `--k-blue-deep` — on headings only, per the build task) is inlined in a `<style>` tag; there is nothing else to load.
6. Prints the document to PDF with Playwright's Chromium — `chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" })` when that sandbox path exists (same override `apps/web/e2e/support.ts` uses and for the same reason), falling back to Playwright's own managed browser otherwise, so the script also runs on a normal `playwright install chromium` machine (CI). Page numbers are added by Playwright's own footer template (`pageNumber` / `totalPages`), not by anything in the document's own CSS.
7. Writes `apps/web/public/guides/<persona>.<lang>.pdf` and, once all sixteen (or fewer, if a persona was skipped) are built, `apps/web/public/guides/index.json`.

### Cover page

Logo from `/brand/logo/okypy_logo_full.png`, inlined as a `data:` URI so the finished PDF has no external file reference. Title is bilingual — the PDF's own language large, the other language smaller underneath, matching the brand's own bilingual-by-default rule (`okypy-brand-guidelines` skill) — persona label in the PDF's own language, from the existing `roles` block in `apps/web/src/i18n/{el,en}.json` (not a new translation: the persona display names already exist and are already parity-checked by `pnpm check:i18n`). Version is `git rev-parse --short HEAD` (`"unversioned"` if there is no git history, e.g. a source export); date is `DD/MM/YYYY`, generated when the script runs.

**No network font fetch.** `brand-tokens.css`'s own `@import url(fonts.googleapis.com/…)` is not loaded here, for the same reason ADR-0003 self-hosts Lato for the app itself: a release build should not depend on outbound internet access at the moment it renders sixteen PDFs. The print CSS uses the plain `Arial, "Helvetica Neue", "Liberation Sans", sans-serif` stack, which is the brand's own documented fallback chain (`okypy-brand-guidelines` skill: "Arial is the agreed fallback… a shortcut, not a colour/logo change").

### Screen tiers (added 20/09/2026)

Owner decision the same day (docs/briefs/README.md Errata "Screen tiers"): the pilot goes live on a capital-and-maintenance basis, so every `help/map.json` entry now carries a `tier` — `"day-one"` (trained and used from the first day) or `"optional"` (built and available, but not part of pilot training). `scripts/build-guides.mjs` reads it straight through `collectPersonaChapters`, which already resolves one representative id per manual section — that id's own `tier` is the section's tier, since every id naming one section carries the same value (`scripts/check-help-mapping.mjs`'s `findInvalidTiers`, which `guides:build` now also runs before touching Chromium, would catch a map that disagreed with itself here if one ever crept in). `splitChaptersByTier` partitions a persona's chapters into the two groups, each keeping its existing screen-id order, and `buildDocumentHtml` assembles them as day-one chapters, then a divider page (`buildDividerHtml`, `class="divider"`, its own page front and back), then the optional chapters — the exact bilingual wording («Προαιρετικές οθόνες — φάση 2» / "Optional screens — phase 2") lives in one place, `dividerLabel()`, that the divider page and the table of contents' own separator row both call. The cover page (`buildCoverHtml`'s new `dayOneTitles`) lists the persona's day-one screens by title in a compact two-column list, so a trainer can see what the pilot actually covers without opening the guide — a persona with zero day-one chapters (none of today's eight) simply gets no list rather than an empty heading. None of this touches a persona with no optional chapters: the divider page and its table-of-contents row are only rendered when `optional.length > 0`.

### Page counting without a new dependency

`index.json` reports each PDF's page count. Chromium's Skia PDF backend, for documents of this size and this pipeline, writes plain, uncompressed PDF objects — no `/ObjStm` object streams — so counting `/Type /Page` occurrences (never `/Type /Pages`, the tree's parent nodes) in the raw bytes is a reliable page count, verified against this build, without adding a PDF-parsing library just to answer one question. `scripts/build-guides.test.mjs` pins this against a small synthetic buffer.

### `index.json` schema

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-19T22:26:05.032Z", // ISO 8601, UTC, when this run finished
  "version": "7c32d99",                      // git short SHA baked into every cover page this run
  "guides": [
    {
      "persona": "estates_head",             // AppRole id, packages/shared/src/auth.ts
      "lang": "el",                          // "el" | "en"
      "file": "estates_head.el.pdf",         // filename inside apps/web/public/guides/
      "personaLabel": "Προϊστάμενος Τεχνικών Υπηρεσιών", // roles.<persona> in that language
      "sections": 25,                        // manual sections assembled into this PDF
      "sizeBytes": 344993,
      "pages": 29,
      "sha256": "8501709a…"                  // sha256 of the PDF bytes, hex
    }
    // … up to 16 entries, in persona order (see PERSONA_ORDER in build-guides.mjs), then el, en
  ]
}
```

`apps/web/src/help/load-guides-index.ts` reads this file for the S26 page (`loadGuidesIndex()`, returns `null` — never throws — when the file is missing or malformed, which is the ordinary state before the first build). A sample of one `buildCoverHtml()` call is committed at `scripts/fixtures/sample-cover.html`, and `scripts/build-guides.test.mjs` (`node --test`) diffs a fixed call against it, plus unit-tests the screen-id sort, the section dedup, the date formatter and the page counter — all without launching a browser.

### Where this is wired in

- `package.json`: `guides:build` runs the script; `test:guides-script` runs its `node --test` suite.
- `.github/workflows/ci.yml`: after the existing checks, installs a Chromium build (`playwright install --with-deps chromium`) and runs `guides:build` — which is also where a `map.json` entry pointing at a missing manual section now fails the build, in addition to `pnpm check:help` already failing on it.
- `deploy/release.sh`: `pnpm guides:build` runs immediately after `pnpm -r build`, so every release's rsync step ships freshly rendered PDFs versioned with that release's commit, per §14. `docs/deploy/RUNBOOK-10.227.56.22.md` §6 says so.
- `.gitignore`: `apps/web/public/guides/*.pdf` and `…/index.json` — both are release artefacts, rebuilt from `docs/manual`, never hand-edited and never committed. This ADR's schema block above is the source of truth for `index.json`'s shape instead.

### Refresh rule

The sixteen PDFs are only ever produced by `scripts/build-guides.mjs`, reading `docs/manual/{el,en}/` and `apps/web/src/help/map.json` as they stand at build time. Nobody edits a PDF, or `index.json`, by hand — a fix belongs in the Markdown source (or the map), and the next `pnpm guides:build` (locally, in CI, or at the next release) picks it up. This is the same posture CAPEX-01 §6.1 already takes for the two other manual renderers: one source, three read-only projections.

## Consequences

- A change to a manual section, or to `help/map.json`'s persona list, is live in the app (S25/S26 read the Markdown directly) before the next release, but the PDFs lag until the next `guides:build` — by design; that is what "generated at release" means. Anyone reading a training PDF sees the cover's version and date and can tell whether it is current.
- `guides:build` needs a Chromium binary. Locally and in this sandbox that is `/opt/pw-browsers`; CI installs its own; a machine with neither fails loudly (Playwright's own error) rather than producing an empty or broken PDF.
- The PDFs are gitignored, so a fresh clone has none until someone runs `guides:build` — the S26 page and the help drawer's footer link both degrade to an explicit "not generated yet" state (`load-guides-index.ts` / `help.centre.empty`) rather than a broken link or a crash.

## Errata — brief items not fully honoured

- **Table of contents page numbers.** The build task asked for a table of contents; this one links to each chapter (a working PDF outline jump, `#chapter-<id>`) but does not print a page number next to each entry. Chromium's print pipeline does not expose per-heading page positions to content-side CSS — `target-counter()`, which is how a browser TOC would normally do this, is not implemented for Chromium's print pagination, only the running footer (`pageNumber`/`totalPages`) is. Printing accurate per-chapter page numbers would need a two-pass render (render once, measure, re-render), which was judged not worth the complexity for a jump-link TOC that already works.
- **"Screen order."** Where several ids share a letter suffix in a different sense than "later variant of the same screen" (`S07` contract detail vs. `S07e` contracts list, `S24` contractors vs. `S24u` users), the sort is alphabetical on the id's own letter, not a hand-curated logical order. It reads sensibly for every persona today; a screen id added later that wants to sort earlier than its letter suggests would need either a rename or a small allow-list, neither of which exists yet.
- **S26 is the guide list only.** UI instructions §5 S26 and CAPEX-01 §6.1 describe the help centre as the guide list *and* a search over the full bilingual manual (R49). Only the list is built here; `docs/manual/{el,en}/S26-help-centre.md` says so in its own "what can go wrong" section, and R49 stays open for a later change.
- **No dedicated top-bar "Βοήθεια" nav item.** UI instructions §5 S26 offers either a top-bar icon or the drawer's empty-state link "whichever exists" — the drawer's link (`helpCentreHref="/help"`, already wired before this change) is what exists, so that is what points at S26; the top bar's own `HelpButton` still only opens the S25 drawer, unchanged.
